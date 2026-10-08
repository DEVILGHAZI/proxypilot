import { ProxyStatus, type ProxyStatus as ProxyStatusName } from "./enums.js";

export const HEALTH_SCORE_MIN = 0;
export const HEALTH_SCORE_MAX = 100;
export const HEALTHY_SCORE_MIN = 70;
export const DEGRADED_SCORE_MIN = 40;

export const SCORE_DELTA = {
  success: 2,
  http5xx: -5,
  timeout: -15,
  connectionFailure: -20,
  repeatedFailure: -10,
} as const;

export const DEFAULT_COOLDOWN_SECONDS = 60;
export const DEFAULT_MAX_COOLDOWN_SECONDS = 3_600;
export const DEFAULT_HEALTH_CHECK_INTERVAL_SECONDS = 60;
export const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5_000;
export const DEFAULT_HEALTH_CHECK_URL = "https://example.com/";
export const LATENCY_AVERAGE_WEIGHT = 0.3;

export const HEALTH_CHECK_JOB = "check";
export const PROXY_RECOVERY_JOB = "recover";

export type HealthThresholds = {
  healthyMin: number;
  degradedMin: number;
};

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  healthyMin: HEALTHY_SCORE_MIN,
  degradedMin: DEGRADED_SCORE_MIN,
};

export type HealthOutcomeKind = "success" | "http_5xx" | "timeout" | "connection_failure";

export type ProbeReason = "manual" | "scheduled" | "recovery";

export type HealthOutcome = {
  kind: HealthOutcomeKind;
  latencyMs: number;
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
};

export type ProxyProbeJob = {
  proxyId: string;
  reason: ProbeReason;
};

export function healthCheckJobId(proxyId: string): string {
  return `check-${proxyId}`;
}

export function clampHealthScore(score: number): number {
  return Math.min(HEALTH_SCORE_MAX, Math.max(HEALTH_SCORE_MIN, Math.round(score)));
}

export function statusForScore(
  score: number,
  thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
): Exclude<ProxyStatusName, "DISABLED"> {
  if (score >= thresholds.healthyMin) {
    return ProxyStatus.HEALTHY;
  }
  if (score >= thresholds.degradedMin) {
    return ProxyStatus.DEGRADED;
  }
  return ProxyStatus.QUARANTINED;
}

export type ScoreInput = {
  status: ProxyStatusName;
  healthScore: number;
  failureCount: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
};

export type ScoreResult = {
  healthScore: number;
  status: ProxyStatusName;
  delta: number;
  repeatedFailure: boolean;
  recoveredFromQuarantine: boolean;
};

function deltaFor(kind: HealthOutcomeKind): number {
  switch (kind) {
    case "success":
      return SCORE_DELTA.success;
    case "http_5xx":
      return SCORE_DELTA.http5xx;
    case "timeout":
      return SCORE_DELTA.timeout;
    case "connection_failure":
      return SCORE_DELTA.connectionFailure;
  }
}

export function isRepeatedFailure(
  current: Pick<ScoreInput, "failureCount" | "lastSuccessAt" | "lastFailureAt">,
  outcome: Pick<HealthOutcome, "kind">,
): boolean {
  if (outcome.kind === "success" || current.failureCount < 1 || !current.lastFailureAt) {
    return false;
  }
  if (current.lastSuccessAt && current.lastSuccessAt > current.lastFailureAt) {
    return false;
  }
  return true;
}

export function applyScore(
  current: ScoreInput,
  outcome: HealthOutcome,
  thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
): ScoreResult {
  let delta = deltaFor(outcome.kind);
  const repeatedFailure = isRepeatedFailure(current, outcome);
  if (repeatedFailure) {
    delta += SCORE_DELTA.repeatedFailure;
  }
  let healthScore = clampHealthScore(current.healthScore + delta);
  const recoveredFromQuarantine = current.status === ProxyStatus.QUARANTINED && outcome.kind === "success";

  if (current.status === ProxyStatus.DISABLED) {
    return {
      healthScore,
      status: ProxyStatus.DISABLED,
      delta,
      repeatedFailure,
      recoveredFromQuarantine: false,
    };
  }

  if (recoveredFromQuarantine) {
    if (healthScore < thresholds.degradedMin) {
      healthScore = thresholds.degradedMin;
    }
    if (healthScore >= thresholds.healthyMin) {
      healthScore = thresholds.healthyMin - 1;
    }
    return {
      healthScore,
      status: ProxyStatus.DEGRADED,
      delta,
      repeatedFailure,
      recoveredFromQuarantine: true,
    };
  }

  return {
    healthScore,
    status: statusForScore(healthScore, thresholds),
    delta,
    repeatedFailure,
    recoveredFromQuarantine: false,
  };
}

export function nextCooldownSeconds(input: {
  alreadyQuarantined: boolean;
  previousCooldownSeconds: number;
  baseSeconds: number;
  maxSeconds: number;
}): number {
  const base = Math.max(1, Math.round(input.baseSeconds));
  const max = Math.max(base, Math.round(input.maxSeconds));
  if (!input.alreadyQuarantined) {
    return base;
  }
  const previous = input.previousCooldownSeconds >= base ? input.previousCooldownSeconds : base;
  return Math.min(max, previous * 2);
}

export function cooldownWindowSeconds(proxy: {
  cooldownUntil: Date | null;
  lastFailureAt: Date | null;
}): number {
  if (!proxy.cooldownUntil || !proxy.lastFailureAt) {
    return 0;
  }
  return Math.max(0, Math.round((proxy.cooldownUntil.getTime() - proxy.lastFailureAt.getTime()) / 1000));
}

export function latencyAverage(current: number | null, sample: number, weight = LATENCY_AVERAGE_WEIGHT): number {
  if (current === null || !Number.isFinite(current)) {
    return Math.round(sample);
  }
  const next = current * (1 - weight) + sample * weight;
  return Math.round(next * 10) / 10;
}
