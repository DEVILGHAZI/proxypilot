import { getPrisma } from "@proxypilot/database";
import { backoffDelayMs, usagePeriodStart } from "@proxypilot/shared";
import { forwardThroughProxy } from "./execute.js";
import { RequestStop, readProxySecret, selectForRequest } from "./select.js";

export async function recordRequestUsage(organizationId: string, now = new Date()): Promise<void> {
  const periodStart = usagePeriodStart(now);
  await getPrisma().usageMeter.upsert({
    where: {
      organizationId_metric_periodStart: {
        organizationId,
        metric: "requests",
        periodStart,
      },
    },
    create: { organizationId, metric: "requests", periodStart, quantity: 1n },
    update: { quantity: { increment: 1n } },
  });
}

export async function sweepRequests(now = new Date()): Promise<void> {
  const prisma = getPrisma();
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1000);
  const stale = await prisma.requestJob.findMany({
    where: { status: { in: ["QUEUED", "RUNNING"] }, createdAt: { lt: staleBefore } },
    select: { id: true, organizationId: true, attempts: true },
    take: 100,
  });
  for (const job of stale) {
    await prisma.$transaction([
      prisma.requestAttempt.create({
        data: { requestId: job.id, attempt: job.attempts + 1, status: "FAILED", errorCode: "STALE" },
      }),
      prisma.requestJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorCode: "STALE", attempts: job.attempts + 1, completedAt: now },
      }),
    ]);
    await recordRequestUsage(job.organizationId, now);
  }
  const old = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  await prisma.requestJob.deleteMany({
    where: { status: { in: ["COMPLETED", "FAILED", "CANCELLED"] }, completedAt: { lt: old } },
  });
}

export async function performRequest(input: {
  requestId: string;
  poolId: string;
  body: string | null;
  encryptionKey: Buffer;
  allowHosts?: ReadonlySet<string>;
  nextCursor: (organizationId: string, poolId: string) => Promise<number>;
  now?: Date;
}): Promise<{ action: "done" } | { action: "retry"; delayMs: number; attempt: number }> {
  const prisma = getPrisma();
  const now = input.now ?? new Date();
  const job = await prisma.requestJob.findUnique({ where: { id: input.requestId } });
  if (!job || job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED") {
    return { action: "done" };
  }

  const prior = await prisma.requestAttempt.findMany({
    where: { requestId: job.id },
    select: { proxyId: true },
  });
  const excludeProxyIds = prior.flatMap((attempt) => (attempt.proxyId ? [attempt.proxyId] : []));

  let selected: Awaited<ReturnType<typeof selectForRequest>>;
  try {
    selected = await selectForRequest({
      organizationId: job.organizationId,
      userId: job.userId,
      poolId: input.poolId,
      nextCursor: input.nextCursor,
      excludeProxyIds,
      now,
    });
  } catch (error) {
    const errorCode = error instanceof RequestStop ? error.errorCode : "SELECTION_FAILED";
    await finishFailure(job.id, job.organizationId, job.attempts + 1, errorCode, now);
    return { action: "done" };
  }

  const attemptNumber = job.attempts + 1;
  await prisma.requestJob.update({
    where: { id: job.id },
    data: {
      status: "RUNNING",
      attempts: attemptNumber,
      policyId: selected.policy.id,
      proxyId: selected.proxy.id,
      sessionId: selected.sessionId,
    },
  });

  let username: string | undefined;
  let password: string | undefined;
  try {
    username = readProxySecret(selected.proxy.usernameEncrypted, input.encryptionKey);
    password = readProxySecret(selected.proxy.passwordEncrypted, input.encryptionKey);
  } catch {
    await writeAttempt({
      requestId: job.id,
      proxyId: selected.proxy.id,
      attempt: attemptNumber,
      status: "FAILED",
      httpStatus: null,
      latencyMs: 0,
      errorCode: "CREDENTIALS",
      retryable: true,
      maxRetries: selected.policy.maxRetries,
      organizationId: job.organizationId,
      now,
    });
    return retryOrDone(attemptNumber, selected.policy.maxRetries, true);
  }

  const result = await forwardThroughProxy({
    protocol: selected.proxy.protocol,
    host: selected.proxy.host,
    port: selected.proxy.port,
    username,
    password,
    url: job.url,
    method: job.method,
    body: input.body,
    timeoutMs: selected.policy.timeoutMs,
    allowHosts: input.allowHosts,
  });

  await writeAttempt({
    requestId: job.id,
    proxyId: selected.proxy.id,
    attempt: attemptNumber,
    status: result.retryable || result.errorCode ? "FAILED" : "COMPLETED",
    httpStatus: result.httpStatus,
    latencyMs: result.latencyMs,
    errorCode: result.errorCode,
    retryable: result.retryable,
    maxRetries: selected.policy.maxRetries,
    organizationId: job.organizationId,
    now,
  });
  return retryOrDone(attemptNumber, selected.policy.maxRetries, result.retryable);
}

function retryOrDone(
  attemptNumber: number,
  maxRetries: number,
  retryable: boolean,
): { action: "done" } | { action: "retry"; delayMs: number; attempt: number } {
  if (retryable && attemptNumber <= maxRetries) {
    return { action: "retry", delayMs: backoffDelayMs(attemptNumber - 1), attempt: attemptNumber };
  }
  return { action: "done" };
}

async function finishFailure(
  requestId: string,
  organizationId: string,
  attempt: number,
  errorCode: string,
  now: Date,
): Promise<void> {
  const prisma = getPrisma();
  await prisma.$transaction([
    prisma.requestAttempt.create({
      data: { requestId, attempt, status: "FAILED", errorCode },
    }),
    prisma.requestJob.update({
      where: { id: requestId },
      data: { status: "FAILED", errorCode, attempts: attempt, completedAt: now },
    }),
  ]);
  await recordRequestUsage(organizationId, now);
}

async function writeAttempt(input: {
  requestId: string;
  proxyId: string;
  attempt: number;
  status: "COMPLETED" | "FAILED";
  httpStatus: number | null;
  latencyMs: number;
  errorCode: string | null;
  retryable: boolean;
  maxRetries: number;
  organizationId: string;
  now: Date;
}): Promise<void> {
  const finished = !input.retryable || input.attempt > input.maxRetries;
  const failed = input.retryable || input.errorCode !== null;
  const jobStatus = finished ? (failed ? "FAILED" : "COMPLETED") : "RUNNING";
  await getPrisma().$transaction([
    getPrisma().requestAttempt.create({
      data: {
        requestId: input.requestId,
        proxyId: input.proxyId,
        attempt: input.attempt,
        status: input.status,
        httpStatus: input.httpStatus,
        latencyMs: input.latencyMs,
        errorCode: input.errorCode,
      },
    }),
    getPrisma().requestJob.update({
      where: { id: input.requestId },
      data: {
        status: jobStatus,
        httpStatus: input.httpStatus,
        latencyMs: input.latencyMs,
        errorCode: finished ? input.errorCode : null,
        attempts: input.attempt,
        completedAt: finished ? input.now : null,
      },
    }),
  ]);
  if (finished) {
    await recordRequestUsage(input.organizationId, input.now);
  }
}
