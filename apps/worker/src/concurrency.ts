import type { AppConfig } from "@proxypilot/config";
import { QUEUE_NAMES, type QueueName } from "@proxypilot/shared";

export function queueConcurrency(
  config: Pick<AppConfig, "HEALTH_CHECK_CONCURRENCY" | "REQUEST_CONCURRENCY">,
): Record<QueueName, number> {
  const concurrency: Record<QueueName, number> = {
    [QUEUE_NAMES.healthCheck]: config.HEALTH_CHECK_CONCURRENCY,
    [QUEUE_NAMES.request]: config.REQUEST_CONCURRENCY,
    [QUEUE_NAMES.retry]: config.REQUEST_CONCURRENCY,
    [QUEUE_NAMES.proxyRecovery]: Math.min(10, config.HEALTH_CHECK_CONCURRENCY),
    [QUEUE_NAMES.analytics]: 2,
    [QUEUE_NAMES.cleanup]: 1,
    [QUEUE_NAMES.siteCheck]: 1,
    [QUEUE_NAMES.system]: 2,
  };

  for (const [name, value] of Object.entries(concurrency)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`Concurrency for ${name} must be a positive integer`);
    }
  }

  return concurrency;
}
