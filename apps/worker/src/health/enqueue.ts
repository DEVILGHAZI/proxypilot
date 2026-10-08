import {
  HEALTH_CHECK_JOB,
  PROXY_RECOVERY_JOB,
  QUEUE_NAMES,
  healthCheckJobId,
  type ProbeReason,
  type ProxyProbeJob,
} from "@proxypilot/shared";
import { Queue, type Job } from "bullmq";

const JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: 100,
} as const;

export async function enqueueHealthCheck(
  queue: Queue,
  proxyId: string,
  reason: Exclude<ProbeReason, "recovery">,
): Promise<"queued" | "already"> {
  const jobId = healthCheckJobId(proxyId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "completed" || state === "failed") {
      await existing.remove();
    } else {
      return "already";
    }
  }
  try {
    await queue.add(HEALTH_CHECK_JOB, { proxyId, reason } satisfies ProxyProbeJob, { ...JOB_OPTIONS, jobId });
  } catch (error) {
    if (error instanceof Error && /already exists/i.test(error.message)) {
      return "already";
    }
    throw error;
  }
  return "queued";
}

async function pendingRecovery(queue: Queue, proxyId: string): Promise<Job[]> {
  const jobs = await queue.getJobs(["delayed", "waiting", "paused"], 0, 500, true);
  return jobs.filter((job) => job.data?.proxyId === proxyId);
}

export async function enqueueProxyRecovery(queue: Queue, proxyId: string, delayMs: number): Promise<void> {
  const pending = await pendingRecovery(queue, proxyId);
  await Promise.all(pending.map((job) => job.remove().catch(() => undefined)));
  await queue.add(
    PROXY_RECOVERY_JOB,
    { proxyId, reason: "recovery" } satisfies ProxyProbeJob,
    { ...JOB_OPTIONS, delay: Math.max(0, Math.round(delayMs)), jobId: `recover-${proxyId}-${Date.now()}` },
  );
}

export async function ensureProxyRecovery(queue: Queue, proxyId: string, delayMs: number): Promise<void> {
  const jobs = await queue.getJobs(["delayed", "waiting", "paused", "active"], 0, 500, true);
  if (jobs.some((job) => job.data?.proxyId === proxyId)) {
    return;
  }
  await enqueueProxyRecovery(queue, proxyId, delayMs);
}

export function createHealthDispatcher(redisUrl: string) {
  const connection = { url: redisUrl, maxRetriesPerRequest: null };
  const checks = new Queue(QUEUE_NAMES.healthCheck, { connection });
  const recovery = new Queue(QUEUE_NAMES.proxyRecovery, { connection });
  return {
    enqueueCheck: (proxyId: string) => enqueueHealthCheck(checks, proxyId, "manual"),
    enqueueRecovery: (proxyId: string, delayMs: number) => enqueueProxyRecovery(recovery, proxyId, delayMs),
    async close() {
      await checks.close();
      await recovery.close();
    },
  };
}
