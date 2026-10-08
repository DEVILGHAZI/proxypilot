import { CLEANUP_JOB, QUEUE_NAMES, REQUEST_JOB, RETRY_JOB, retryJobId, rotationCursorKey } from "@proxypilot/shared";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { readRequestJob } from "./enqueue.js";
import { performRequest, sweepRequests } from "./run.js";

const JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: 100,
} as const;

export async function startRequestConsumers(options: {
  redisUrl: string;
  encryptionKey: Buffer;
  concurrency: number;
  allowHosts?: ReadonlySet<string>;
  logger?: {
    info: (obj: object, msg?: string) => void;
    warn: (obj: object, msg?: string) => void;
  };
}): Promise<{ close: () => Promise<void> }> {
  const cursor = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
  const requestConnection = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
  const retryConnection = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
  const cleanupConnection = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
  const retryQueue = new Queue(QUEUE_NAMES.retry, { connection: { url: options.redisUrl, maxRetriesPerRequest: null } });
  const cleanupQueue = new Queue(QUEUE_NAMES.cleanup, {
    connection: { url: options.redisUrl, maxRetriesPerRequest: null },
  });

  const nextCursor = (organizationId: string, poolId: string) => cursor.incr(rotationCursorKey(organizationId, poolId));

  const run = async (data: unknown) => {
    const parsed = readRequestJob(data);
    if (!parsed) {
      throw new Error("Request job is missing its id.");
    }
    const outcome = await performRequest({
      requestId: parsed.requestId,
      poolId: parsed.poolId,
      body: parsed.body,
      encryptionKey: options.encryptionKey,
      allowHosts: options.allowHosts,
      nextCursor,
    });
    if (outcome.action === "retry") {
      try {
        await retryQueue.add(RETRY_JOB, parsed, {
          ...JOB_OPTIONS,
          delay: outcome.delayMs,
          jobId: retryJobId(parsed.requestId, outcome.attempt),
        });
      } catch (error) {
        if (!(error instanceof Error) || !/already exists/i.test(error.message)) {
          throw error;
        }
      }
    }
    options.logger?.info({ requestId: parsed.requestId, action: outcome.action }, "request attempt finished");
  };

  const requestWorker = new Worker(QUEUE_NAMES.request, async (job) => {
    if (job.name !== REQUEST_JOB) {
      throw new Error(`Unsupported request job: ${job.name}`);
    }
    await run(job.data);
  }, { connection: requestConnection, concurrency: options.concurrency });

  const retryWorker = new Worker(QUEUE_NAMES.retry, async (job) => {
    if (job.name !== RETRY_JOB) {
      throw new Error(`Unsupported retry job: ${job.name}`);
    }
    await run(job.data);
  }, { connection: retryConnection, concurrency: options.concurrency });

  const cleanupWorker = new Worker(QUEUE_NAMES.cleanup, async (job) => {
    if (job.name !== CLEANUP_JOB) {
      throw new Error(`Unsupported cleanup job: ${job.name}`);
    }
    await sweepRequests();
  }, { connection: cleanupConnection, concurrency: 1 });

  await Promise.all([requestWorker.waitUntilReady(), retryWorker.waitUntilReady(), cleanupWorker.waitUntilReady()]);

  const sweep = async () => {
    try {
      await cleanupQueue.add(CLEANUP_JOB, {}, { ...JOB_OPTIONS, jobId: "sweep-requests" });
    } catch (error) {
      if (!(error instanceof Error) || !/already exists/i.test(error.message)) {
        options.logger?.warn({ message: error instanceof Error ? error.message : "sweep failed" }, "request sweep failed");
      }
    }
  };
  await sweep();
  const timer = setInterval(() => {
    void sweep();
  }, 60_000);

  return {
    async close() {
      clearInterval(timer);
      await requestWorker.close();
      await retryWorker.close();
      await cleanupWorker.close();
      await retryQueue.close();
      await cleanupQueue.close();
      cursor.disconnect();
      requestConnection.disconnect();
      retryConnection.disconnect();
      cleanupConnection.disconnect();
    },
  };
}
