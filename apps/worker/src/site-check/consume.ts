import { QUEUE_NAMES, SITE_CHECK_JOB } from "@proxypilot/shared";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { readSiteCheckJob } from "./enqueue.js";
import { performSiteCheck } from "./run.js";

export async function startSiteCheckConsumer(options: {
  redisUrl: string;
  encryptionKey: Buffer;
  logger?: { warn: (obj: object, msg?: string) => void };
}) {
  const connection = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
  const worker = new Worker(
    QUEUE_NAMES.siteCheck,
    async (job) => {
      if (job.name !== SITE_CHECK_JOB) {
        throw new Error(`Unsupported site check job: ${job.name}`);
      }
      const parsed = readSiteCheckJob(job.data);
      if (!parsed) {
        throw new Error("Site check job is missing a check id.");
      }
      await performSiteCheck(parsed.checkId, options.encryptionKey);
    },
    { connection, concurrency: 1 },
  );
  worker.on("failed", (job, error) => {
    options.logger?.warn({ jobId: job?.id, message: error.message }, "site check failed");
  });
  await worker.waitUntilReady();
  return {
    async close() {
      await worker.close();
      connection.disconnect();
    },
  };
}
