import { ProxyStatus, RotationStrategy, type ProxyStatus as ProxyStatusName, type RotationStrategy as RotationStrategyName } from "./enums.js";

export const ROTATION_CURSOR_PREFIX = "rotation:cursor";

export type RotationCandidate = {
  id: string;
  status: ProxyStatusName;
  healthScore: number;
  avgLatencyMs: number | null;
  cooldownUntil: Date | null;
};

export function rotationCursorKey(organizationId: string, poolId: string): string {
  return `${ROTATION_CURSOR_PREFIX}:${organizationId}:${poolId}`;
}

export function isEligible(candidate: RotationCandidate, now: Date): boolean {
  if (candidate.status !== ProxyStatus.HEALTHY && candidate.status !== ProxyStatus.DEGRADED) {
    return false;
  }
  if (candidate.cooldownUntil && candidate.cooldownUntil.getTime() > now.getTime()) {
    return false;
  }
  return true;
}

export function eligibleProxies(candidates: RotationCandidate[], now: Date): RotationCandidate[] {
  return candidates.filter((candidate) => isEligible(candidate, now)).sort((left, right) => left.id.localeCompare(right.id));
}

function positiveModulo(value: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return ((value % length) + length) % length;
}

function pickWeighted(candidates: RotationCandidate[], random: () => number): RotationCandidate {
  const weights = candidates.map((candidate) => Math.max(0, candidate.healthScore));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) {
    return candidates[positiveModulo(Math.floor(random() * candidates.length), candidates.length)] ?? candidates[0]!;
  }
  let ticket = random() * total;
  for (let index = 0; index < candidates.length; index += 1) {
    ticket -= weights[index] ?? 0;
    if (ticket < 0) {
      return candidates[index]!;
    }
  }
  return candidates[candidates.length - 1]!;
}

function pickLeastLatency(candidates: RotationCandidate[]): RotationCandidate {
  return [...candidates].sort((left, right) => {
    if (left.avgLatencyMs === null && right.avgLatencyMs === null) {
      return left.id.localeCompare(right.id);
    }
    if (left.avgLatencyMs === null) {
      return 1;
    }
    if (right.avgLatencyMs === null) {
      return -1;
    }
    if (left.avgLatencyMs !== right.avgLatencyMs) {
      return left.avgLatencyMs - right.avgLatencyMs;
    }
    return left.id.localeCompare(right.id);
  })[0]!;
}

export function pickProxy(input: {
  strategy: RotationStrategyName;
  candidates: RotationCandidate[];
  cursor: number;
  random?: () => number;
  now?: Date;
}): RotationCandidate | null {
  const now = input.now ?? new Date();
  const eligible = eligibleProxies(input.candidates, now);
  if (eligible.length === 0) {
    return null;
  }
  const random = input.random ?? Math.random;
  if (input.strategy === RotationStrategy.RANDOM || input.strategy === RotationStrategy.STICKY_SESSION) {
    if (input.strategy === RotationStrategy.STICKY_SESSION) {
      const index = positiveModulo(Math.max(input.cursor, 1) - 1, eligible.length);
      return eligible[index] ?? null;
    }
    const index = positiveModulo(Math.floor(random() * eligible.length), eligible.length);
    return eligible[index] ?? null;
  }
  if (input.strategy === RotationStrategy.LEAST_LATENCY) {
    return pickLeastLatency(eligible);
  }
  if (input.strategy === RotationStrategy.WEIGHTED_HEALTH) {
    return pickWeighted(eligible, random);
  }
  const index = positiveModulo(Math.max(input.cursor, 1) - 1, eligible.length);
  return eligible[index] ?? null;
}
