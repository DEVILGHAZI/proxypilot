import { decryptString, getPrisma } from "@proxypilot/database";
import {
  ProxyStatus,
  applyScore,
  cooldownWindowSeconds,
  latencyAverage,
  nextCooldownSeconds,
  type HealthOutcome,
  type HealthThresholds,
  type ProbeReason,
  type ProxyStatus as ProxyStatusName,
} from "@proxypilot/shared";
import { probeProxy, type ProbeTarget } from "./probe.js";

export type RecordedHealth = {
  proxyId: string;
  status: ProxyStatusName;
  healthScore: number;
  scheduleRecovery: boolean;
  recoveryDelayMs: number;
};

function checkFields(outcome: HealthOutcome): {
  status: "SUCCESS" | "FAILED";
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
} {
  if (outcome.kind === "success") {
    return {
      status: "SUCCESS",
      httpStatus: outcome.httpStatus ?? null,
      errorCode: null,
      errorMessage: null,
    };
  }
  return {
    status: "FAILED",
    httpStatus: outcome.httpStatus ?? null,
    errorCode: outcome.errorCode ?? (outcome.kind === "timeout" ? "TIMEOUT" : "FAILED"),
    errorMessage: outcome.errorMessage?.slice(0, 200) ?? null,
  };
}

export async function recordProxyHealth(input: {
  proxyId: string;
  outcome: HealthOutcome;
  cooldownSeconds: number;
  maxCooldownSeconds: number;
  thresholds?: HealthThresholds;
  now?: Date;
}): Promise<RecordedHealth | null> {
  const prisma = getPrisma();
  const proxy = await prisma.proxy.findUnique({ where: { id: input.proxyId } });
  if (!proxy) {
    return null;
  }
  const now = input.now ?? new Date();
  const scored = applyScore(proxy, input.outcome, input.thresholds);
  const scheduleRecovery = scored.status === ProxyStatus.QUARANTINED;
  const recoveryDelayMs = scheduleRecovery
    ? nextCooldownSeconds({
        alreadyQuarantined: proxy.status === ProxyStatus.QUARANTINED,
        previousCooldownSeconds: cooldownWindowSeconds(proxy),
        baseSeconds: input.cooldownSeconds,
        maxSeconds: input.maxCooldownSeconds,
      }) * 1000
    : 0;
  const cooldownUntil = scheduleRecovery ? new Date(now.getTime() + recoveryDelayMs) : null;
  const fields = checkFields(input.outcome);

  await prisma.$transaction(async (tx) => {
    await tx.healthCheck.create({
      data: {
        proxyId: proxy.id,
        status: fields.status,
        latencyMs: input.outcome.latencyMs,
        httpStatus: fields.httpStatus,
        errorCode: fields.errorCode,
        errorMessage: fields.errorMessage,
        checkedAt: now,
      },
    });
    await tx.proxy.update({
      where: { id: proxy.id },
      data: {
        healthScore: scored.healthScore,
        status: scored.status,
        avgLatencyMs: latencyAverage(proxy.avgLatencyMs, input.outcome.latencyMs),
        lastCheckedAt: now,
        cooldownUntil,
        ...(input.outcome.kind === "success"
          ? { successCount: { increment: 1 }, lastSuccessAt: now }
          : {
              failureCount: { increment: 1 },
              lastFailureAt: now,
              ...(input.outcome.kind === "timeout" ? { timeoutCount: { increment: 1 } } : {}),
              ...(input.outcome.kind === "connection_failure" ? { connectionErrorCount: { increment: 1 } } : {}),
            }),
      },
    });
    if (proxy.status !== scored.status) {
      await tx.auditLog.create({
        data: {
          organizationId: proxy.organizationId,
          action: "SETTINGS_CHANGED",
          resource: "proxy",
          resourceId: proxy.id,
          metadata: {
            from: proxy.status,
            to: scored.status,
            healthScore: scored.healthScore,
            reason: "health_check",
          },
        },
      });
    }
  });

  return {
    proxyId: proxy.id,
    status: scored.status,
    healthScore: scored.healthScore,
    scheduleRecovery,
    recoveryDelayMs,
  };
}

function readSecret(payload: string | null, key: Buffer): string | undefined {
  if (!payload) {
    return undefined;
  }
  return decryptString(payload, key);
}

export async function performHealthCheck(input: {
  proxyId: string;
  reason: ProbeReason;
  encryptionKey: Buffer;
  targetUrl: string;
  timeoutMs: number;
  intervalSeconds: number;
  cooldownSeconds: number;
  maxCooldownSeconds: number;
  thresholds?: HealthThresholds;
  now?: Date;
  probe?: (target: ProbeTarget) => Promise<HealthOutcome>;
}): Promise<RecordedHealth | null> {
  const prisma = getPrisma();
  const proxy = await prisma.proxy.findUnique({ where: { id: input.proxyId } });
  if (!proxy) {
    return null;
  }
  const now = input.now ?? new Date();
  if (input.reason === "scheduled") {
    if (proxy.status === ProxyStatus.DISABLED || proxy.status === ProxyStatus.QUARANTINED) {
      return null;
    }
    if (proxy.lastCheckedAt && now.getTime() - proxy.lastCheckedAt.getTime() < input.intervalSeconds * 1000) {
      return null;
    }
  }
  if (input.reason === "recovery") {
    if (proxy.status !== ProxyStatus.QUARANTINED) {
      return null;
    }
    if (proxy.cooldownUntil && proxy.cooldownUntil.getTime() > now.getTime() + 1_000) {
      return {
        proxyId: proxy.id,
        status: proxy.status,
        healthScore: proxy.healthScore,
        scheduleRecovery: true,
        recoveryDelayMs: proxy.cooldownUntil.getTime() - now.getTime(),
      };
    }
  }

  let outcome: HealthOutcome;
  try {
    outcome = await (input.probe ?? probeProxy)({
      protocol: proxy.protocol,
      host: proxy.host,
      port: proxy.port,
      username: readSecret(proxy.usernameEncrypted, input.encryptionKey),
      password: readSecret(proxy.passwordEncrypted, input.encryptionKey),
      targetUrl: input.targetUrl,
      timeoutMs: input.timeoutMs,
    });
  } catch (error) {
    outcome = {
      kind: "connection_failure",
      latencyMs: 0,
      errorCode: "CREDENTIALS",
      errorMessage: error instanceof Error ? "Proxy credentials could not be read." : "Proxy probe failed.",
    };
  }

  return recordProxyHealth({
    proxyId: proxy.id,
    outcome,
    cooldownSeconds: input.cooldownSeconds,
    maxCooldownSeconds: input.maxCooldownSeconds,
    thresholds: input.thresholds,
    now,
  });
}

export async function listDueProxies(input: { intervalSeconds: number; limit: number; now?: Date }): Promise<{
  checks: string[];
  recoveries: Array<{ proxyId: string; delayMs: number }>;
}> {
  const prisma = getPrisma();
  const now = input.now ?? new Date();
  const dueBefore = new Date(now.getTime() - input.intervalSeconds * 1000);
  const [checks, quarantined] = await Promise.all([
    prisma.proxy.findMany({
      where: {
        status: { in: [ProxyStatus.HEALTHY, ProxyStatus.DEGRADED] },
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: dueBefore } }],
      },
      select: { id: true },
      take: input.limit,
      orderBy: { lastCheckedAt: "asc" },
    }),
    prisma.proxy.findMany({
      where: { status: ProxyStatus.QUARANTINED },
      select: { id: true, cooldownUntil: true },
      take: input.limit,
    }),
  ]);
  return {
    checks: checks.map((proxy) => proxy.id),
    recoveries: quarantined.map((proxy) => ({
      proxyId: proxy.id,
      delayMs: proxy.cooldownUntil ? Math.max(0, proxy.cooldownUntil.getTime() - now.getTime()) : 0,
    })),
  };
}
