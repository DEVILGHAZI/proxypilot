import "./load-env.js";
import { loadConfig } from "@proxypilot/config";
import { decodeEncryptionKey, disconnectDatabase } from "@proxypilot/database";
import { createLogger, redactSecrets } from "@proxypilot/logger";
import { WORKER_HEARTBEAT_KEY, parseAllowHosts } from "@proxypilot/shared";
import { queueConcurrency } from "./concurrency.js";
import { startSystemWorker } from "./worker.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger({ name: "proxypilot-worker", level: config.LOG_LEVEL });
  const concurrency = queueConcurrency(config);
  logger.info({ concurrency }, "queue concurrency");

  const runtime = await startSystemWorker({
    redisUrl: config.REDIS_URL,
    heartbeatKey: WORKER_HEARTBEAT_KEY,
    concurrency: concurrency.system,
    health: {
      encryptionKey: decodeEncryptionKey(config.ENCRYPTION_KEY),
      targetUrl: config.HEALTH_CHECK_URL,
      timeoutMs: config.HEALTH_CHECK_TIMEOUT_MS,
      intervalSeconds: config.HEALTH_CHECK_INTERVAL_SECONDS,
      cooldownSeconds: config.HEALTH_COOLDOWN_SECONDS,
      maxCooldownSeconds: config.HEALTH_MAX_COOLDOWN_SECONDS,
      thresholds: {
        healthyMin: config.HEALTHY_SCORE_MIN,
        degradedMin: config.DEGRADED_SCORE_MIN,
      },
      checkConcurrency: concurrency["health-check"],
      recoveryConcurrency: concurrency["proxy-recovery"],
      logger,
    },
    requests: {
      encryptionKey: decodeEncryptionKey(config.ENCRYPTION_KEY),
      concurrency: concurrency.request,
      allowHosts: parseAllowHosts(config.SSRF_ALLOW_HOSTS),
      logger,
    },
  });

  logger.info("worker listening");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    await runtime.close();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Worker failed to start";
  process.stderr.write(`${redactSecrets(message)}\n`);
  process.exit(1);
});
