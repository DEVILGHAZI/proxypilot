import { QUEUE_NAMES, SITE_CHECK_JOB } from "@proxypilot/shared";
import { Queue } from "bullmq";

export type SiteCheckQueueJob = {
  checkId: string;
};

const JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: 100,
} as const;

export function readSiteCheckJob(data: unknown): SiteCheckQueueJob | null {
  if (typeof data !== "object" || data === null || !("checkId" in data) || typeof data.checkId !== "string") {
    return null;
  }
  if (data.checkId.length === 0) {
    return null;
  }
  return { checkId: data.checkId };
}

export function createSiteCheckDispatcher(redisUrl: string) {
  const connection = { url: redisUrl, maxRetriesPerRequest: null };
  const checks = new Queue(QUEUE_NAMES.siteCheck, { connection });
  return {
    enqueue(job: SiteCheckQueueJob) {
      return checks.add(SITE_CHECK_JOB, job, { ...JOB_OPTIONS, jobId: `site-check-${job.checkId}` });
    },
    async close() {
      await checks.close();
    },
  };
}
