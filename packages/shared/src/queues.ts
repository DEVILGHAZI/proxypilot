export const QUEUE_NAMES = {
  healthCheck: "health-check",
  request: "request",
  retry: "retry",
  proxyRecovery: "proxy-recovery",
  analytics: "analytics",
  cleanup: "cleanup",
  siteCheck: "site-check",
  system: "system",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const REQUIRED_QUEUE_NAMES = [
  QUEUE_NAMES.healthCheck,
  QUEUE_NAMES.request,
  QUEUE_NAMES.retry,
  QUEUE_NAMES.proxyRecovery,
  QUEUE_NAMES.analytics,
  QUEUE_NAMES.cleanup,
  QUEUE_NAMES.siteCheck,
] as const satisfies readonly QueueName[];

export const WORKER_HEARTBEAT_KEY = "worker:heartbeat";
export const SYSTEM_PING_JOB = "ping";

export const ID_PREFIX = {
  request: "req",
  apiKey: "pp_live",
} as const;
