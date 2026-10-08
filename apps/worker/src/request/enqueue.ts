import { QUEUE_NAMES, REQUEST_JOB } from "@proxypilot/shared";
import { Queue } from "bullmq";

export type RequestQueueJob = {
  requestId: string;
  poolId: string;
  body: string | null;
};

const JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: 100,
} as const;

export function readRequestJob(data: unknown): RequestQueueJob | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const requestId = "requestId" in data ? data.requestId : undefined;
  const poolId = "poolId" in data ? data.poolId : undefined;
  if (typeof requestId !== "string" || requestId.length === 0 || typeof poolId !== "string" || poolId.length === 0) {
    return null;
  }
  const body = "body" in data && typeof data.body === "string" ? data.body : null;
  return { requestId, poolId, body };
}

export function createRequestDispatcher(redisUrl: string) {
  const connection = { url: redisUrl, maxRetriesPerRequest: null };
  const requests = new Queue(QUEUE_NAMES.request, { connection });
  return {
    enqueue(job: RequestQueueJob) {
      return requests.add(REQUEST_JOB, job, { ...JOB_OPTIONS, jobId: `request-${job.requestId}` });
    },
    async close() {
      await requests.close();
    },
  };
}
