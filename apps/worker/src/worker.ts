import {
  HEALTH_CHECK_JOB,
  PROXY_RECOVERY_JOB,
  QUEUE_NAMES,
  REQUIRED_QUEUE_NAMES,
  SYSTEM_PING_JOB,
  type HealthThresholds,
  type ProbeReason,
  type ProxyProbeJob,
} from "@proxypilot/shared";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { enqueueHealthCheck, enqueueProxyRecovery, ensureProxyRecovery } from "./health/enqueue.js";
import { listDueProxies, performHealthCheck } from "./health/record.js";
import { startRequestConsumers } from "./request/consume.js";
import { startSiteCheckConsumer } from "./site-check/consume.js";

export type SystemWorker = {
  enqueuePing: () => Promise<void>;
  close: () => Promise<void>;
};

export type HealthWorkerOptions = {
  encryptionKey: Buffer;
  targetUrl: string;
  timeoutMs: number;
  intervalSeconds: number;
  cooldownSeconds: number;
  maxCooldownSeconds: number;
  thresholds: HealthThresholds;
  checkConcurrency: number;
  recoveryConcurrency: number;
  schedule?: boolean;
  logger?: {
    info: (obj: object, msg?: string) => void;
    warn: (obj: object, msg?: string) => void;
  };
};

export type RequestWorkerOptions = {
  encryptionKey: Buffer;
  concurrency: number;
  allowHosts?: ReadonlySet<string>;
  logger?: {
    info: (obj: object, msg?: string) => void;
    warn: (obj: object, msg?: string) => void;
  };
};

function readProbeJob(data: unknown, fallback: ProbeReason): ProxyProbeJob | null {
  if (typeof data !== "object" || data === null || !("proxyId" in data)) {
    return null;
  }
  const proxyId = data.proxyId;
  if (typeof proxyId !== "string" || proxyId.length === 0) {
    return null;
  }
  const reason =
    "reason" in data && (data.reason === "manual" || data.reason === "scheduled" || data.reason === "recovery")
      ? data.reason
      : fallback;
  return { proxyId, reason };
}

export async function startSystemWorker(options: {
  redisUrl: string;
  queueName?: string;
  heartbeatKey: string;
  concurrency: number;
  intervalMs?: number;
  health?: HealthWorkerOptions;
  requests?: RequestWorkerOptions;
}): Promise<SystemWorker> {
  const queueName = options.queueName ?? QUEUE_NAMES.system;
  const publisher = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
  const workerConnection = new Redis(options.redisUrl, { maxRetriesPerRequest: null });

  const declared = REQUIRED_QUEUE_NAMES.map((name) => new Queue(name, { connection: publisher }));
  const systemQueue = new Queue(queueName, { connection: publisher });

  const writeHeartbeat = async (source: "ping" | "interval") => {
    await publisher.set(
      options.heartbeatKey,
      JSON.stringify({
        source,
        at: new Date().toISOString(),
        pid: process.pid,
      }),
      "EX",
      30,
    );
  };

  const worker = new Worker(
    queueName,
    async (job) => {
      if (job.name !== SYSTEM_PING_JOB) {
        throw new Error(`Unsupported system job: ${job.name}`);
      }
      await writeHeartbeat("ping");
      return { ok: true };
    },
    {
      connection: workerConnection,
      concurrency: options.concurrency,
    },
  );

  await Promise.all([
    worker.waitUntilReady(),
    systemQueue.waitUntilReady(),
    ...declared.map((queue) => queue.waitUntilReady()),
  ]);

  const intervalMs = options.intervalMs ?? 10_000;
  let timer: NodeJS.Timeout | undefined;
  if (intervalMs > 0) {
    await writeHeartbeat("interval");
    timer = setInterval(() => {
      void writeHeartbeat("interval");
    }, intervalMs);
  }

  const health = options.health;
  let checkWorker: Worker | undefined;
  let recoveryWorker: Worker | undefined;
  let scheduleTimer: NodeJS.Timeout | undefined;
  let checkConnection: Redis | undefined;
  let recoveryConnection: Redis | undefined;
  const healthQueue = declared.find((queue) => queue.name === QUEUE_NAMES.healthCheck);
  const recoveryQueue = declared.find((queue) => queue.name === QUEUE_NAMES.proxyRecovery);

  const runProbe = async (jobData: unknown, fallback: ProbeReason) => {
    if (!health) {
      return;
    }
    const parsed = readProbeJob(jobData, fallback);
    if (!parsed) {
      throw new Error("Health job is missing a proxy id.");
    }
    const result = await performHealthCheck({
      proxyId: parsed.proxyId,
      reason: parsed.reason,
      encryptionKey: health.encryptionKey,
      targetUrl: health.targetUrl,
      timeoutMs: health.timeoutMs,
      intervalSeconds: health.intervalSeconds,
      cooldownSeconds: health.cooldownSeconds,
      maxCooldownSeconds: health.maxCooldownSeconds,
      thresholds: health.thresholds,
    });
    if (result?.scheduleRecovery && recoveryQueue) {
      await enqueueProxyRecovery(recoveryQueue, result.proxyId, result.recoveryDelayMs);
    }
    health.logger?.info(
      {
        proxyId: parsed.proxyId,
        reason: parsed.reason,
        status: result?.status,
        healthScore: result?.healthScore,
      },
      "proxy health check finished",
    );
  };

  const scanDue = async () => {
    if (!health || !healthQueue || !recoveryQueue) {
      return;
    }
    const due = await listDueProxies({ intervalSeconds: health.intervalSeconds, limit: 100 });
    for (const proxyId of due.checks) {
      await enqueueHealthCheck(healthQueue, proxyId, "scheduled");
    }
    for (const recovery of due.recoveries) {
      await ensureProxyRecovery(recoveryQueue, recovery.proxyId, recovery.delayMs);
    }
  };

  if (health && healthQueue && recoveryQueue) {
    checkConnection = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
    recoveryConnection = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
    checkWorker = new Worker(
      QUEUE_NAMES.healthCheck,
      async (job) => {
        if (job.name !== HEALTH_CHECK_JOB) {
          throw new Error(`Unsupported health job: ${job.name}`);
        }
        await runProbe(job.data, "scheduled");
      },
      { connection: checkConnection, concurrency: health.checkConcurrency },
    );
    recoveryWorker = new Worker(
      QUEUE_NAMES.proxyRecovery,
      async (job) => {
        if (job.name !== PROXY_RECOVERY_JOB) {
          throw new Error(`Unsupported recovery job: ${job.name}`);
        }
        await runProbe(job.data, "recovery");
      },
      { connection: recoveryConnection, concurrency: health.recoveryConcurrency },
    );
    await Promise.all([checkWorker.waitUntilReady(), recoveryWorker.waitUntilReady()]);
    if (health.schedule !== false) {
      await scanDue();
      scheduleTimer = setInterval(() => {
        void scanDue().catch((error: unknown) => {
          health.logger?.warn({ message: error instanceof Error ? error.message : "scan failed" }, "health scan failed");
        });
      }, health.intervalSeconds * 1000);
    }
  }

  const requestRuntime = options.requests
    ? await startRequestConsumers({
        redisUrl: options.redisUrl,
        encryptionKey: options.requests.encryptionKey,
        concurrency: options.requests.concurrency,
        allowHosts: options.requests.allowHosts,
        logger: options.requests.logger,
      })
    : undefined;
  const siteCheckRuntime = options.requests
    ? await startSiteCheckConsumer({
        redisUrl: options.redisUrl,
        encryptionKey: options.requests.encryptionKey,
        logger: options.requests.logger,
      })
    : undefined;

  return {
    async enqueuePing() {
      await systemQueue.add(SYSTEM_PING_JOB, {});
    },
    async close() {
      if (timer) {
        clearInterval(timer);
      }
      if (scheduleTimer) {
        clearInterval(scheduleTimer);
      }
      await siteCheckRuntime?.close();
      await requestRuntime?.close();
      await checkWorker?.close();
      await recoveryWorker?.close();
      await worker.close();
      await systemQueue.close();
      await Promise.all(declared.map((queue) => queue.close()));
      publisher.disconnect();
      workerConnection.disconnect();
      checkConnection?.disconnect();
      recoveryConnection?.disconnect();
    },
  };
}

export { performHealthCheck, recordProxyHealth } from "./health/record.js";
export { performRequest } from "./request/run.js";
