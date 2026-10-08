import "./load-env.js";
import { loadConfig } from "@proxypilot/config";
import { checkDatabase, decodeEncryptionKey, disconnectDatabase } from "@proxypilot/database";
import { createLogger, redactSecrets } from "@proxypilot/logger";
import { WORKER_HEARTBEAT_KEY, parseAllowHosts, rotationCursorKey } from "@proxypilot/shared";
import { createHealthDispatcher } from "@proxypilot/worker/health-queue";
import { createRequestDispatcher } from "@proxypilot/worker/request-queue";
import { createSiteCheckDispatcher } from "@proxypilot/worker/site-check-queue";
import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { takeWindow } from "./requests/limit.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger({ name: "proxypilot-api", level: config.LOG_LEVEL });
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

  redis.on("error", (error: Error) => {
    logger.warn(redactSecrets({ message: error.message }), "redis connection error");
  });

  const healthQueue = createHealthDispatcher(config.REDIS_URL);
  const requestQueue = createRequestDispatcher(config.REDIS_URL);
  const siteCheckQueue = createSiteCheckDispatcher(config.REDIS_URL);
  const app = buildApp({
    logger,
    webOrigin: config.WEB_ORIGIN,
    nodeEnv: config.NODE_ENV,
    auth: {
      sessionSecret: config.SESSION_SECRET,
      nodeEnv: config.NODE_ENV,
      counter: redis,
      encryptionKey: decodeEncryptionKey(config.ENCRYPTION_KEY),
      health: {
        enqueueCheck: healthQueue.enqueueCheck,
        enqueueRecovery: healthQueue.enqueueRecovery,
        cooldownSeconds: config.HEALTH_COOLDOWN_SECONDS,
        thresholds: {
          healthyMin: config.HEALTHY_SCORE_MIN,
          degradedMin: config.DEGRADED_SCORE_MIN,
        },
      },
      nextCursor: async (organizationId, poolId) => redis.incr(rotationCursorKey(organizationId, poolId)),
      requests: {
        enqueue: requestQueue.enqueue,
        takeSlot: (key, limit) => takeWindow(redis, key, limit),
        limits: {
          org: config.ORG_REQUESTS_PER_SECOND,
          user: config.USER_REQUESTS_PER_SECOND,
          apiKey: config.API_KEY_REQUESTS_PER_SECOND,
          domain: config.DOMAIN_REQUESTS_PER_SECOND,
        },
        allowHosts: parseAllowHosts(config.SSRF_ALLOW_HOSTS),
      },
      siteChecks: {
        enqueue: siteCheckQueue.enqueue,
        allowHosts: parseAllowHosts(config.SSRF_ALLOW_HOSTS),
      },
    },
    checks: {
      postgres: () => checkDatabase(),
      redis: async () => {
        const pong = await redis.ping();
        if (pong !== "PONG") {
          throw new Error("Redis ping failed");
        }
      },
      workerHeartbeat: () => redis.get(WORKER_HEARTBEAT_KEY),
    },
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "api shutting down");
    await app.close();
    await healthQueue.close();
    await requestQueue.close();
    await siteCheckQueue.close();
    await redis.quit();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await app.listen({ host: config.API_HOST, port: config.API_PORT });
  logger.info({ host: config.API_HOST, port: config.API_PORT }, "api listening");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "API failed to start";
  process.stderr.write(`${redactSecrets(message)}\n`);
  process.exit(1);
});
