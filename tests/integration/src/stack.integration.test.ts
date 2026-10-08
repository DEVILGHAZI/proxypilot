import { buildApp } from "@proxypilot/api/app";
import { loadConfig } from "@proxypilot/config";
import { checkDatabase, disconnectDatabase, getPrisma } from "@proxypilot/database";
import { createLogger } from "@proxypilot/logger";
import { WORKER_HEARTBEAT_KEY } from "@proxypilot/shared";
import { startSystemWorker } from "@proxypilot/worker";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";

const config = loadConfig();
const logger = createLogger({ name: "integration", level: "silent" });
const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
});

afterAll(async () => {
  redis.disconnect();
  await disconnectDatabase();
});

describe("foundation stack", () => {
  it("records the initial migration and answers SELECT 1", async () => {
    const prisma = getPrisma();
    await checkDatabase(prisma);
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    expect(rows.some((row) => row.migration_name.includes("init"))).toBe(true);
  });

  it("pings redis and serves health endpoints", async () => {
    if (redis.status !== "ready") {
      await redis.connect();
    }
    const app = buildApp({
      logger,
      webOrigin: config.WEB_ORIGIN,
      nodeEnv: "test",
      checks: {
        postgres: () => checkDatabase(),
        redis: async () => {
          const pong = await redis.ping();
          if (pong !== "PONG") {
            throw new Error("redis ping failed");
          }
        },
        workerHeartbeat: () => redis.get(WORKER_HEARTBEAT_KEY),
      },
    });

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json().data.status).toBe("ok");

    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().data.checks.postgres).toBe("up");
    expect(ready.json().data.checks.redis).toBe("up");
    await app.close();
  });

  it("writes a worker heartbeat from a BullMQ ping", async () => {
    if (redis.status !== "ready") {
      await redis.connect();
    }
    const heartbeatKey = `worker:heartbeat:test:${process.pid}`;
    const runtime = await startSystemWorker({
      redisUrl: config.REDIS_URL,
      queueName: `system-test-${process.pid}`,
      heartbeatKey,
      concurrency: 1,
      intervalMs: 0,
    });

    try {
      await runtime.enqueuePing();
      const started = Date.now();
      let payload: string | null = null;
      while (Date.now() - started < 10_000) {
        payload = await redis.get(heartbeatKey);
        if (payload?.includes('"ping"')) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(payload).toBeTruthy();
      expect(JSON.parse(payload ?? "{}").source).toBe("ping");
    } finally {
      await runtime.close();
    }
  });
});
