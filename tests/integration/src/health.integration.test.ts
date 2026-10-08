import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { buildApp } from "@proxypilot/api/app";
import { loadConfig } from "@proxypilot/config";
import { decodeEncryptionKey, disconnectDatabase, getPrisma } from "@proxypilot/database";
import { createLogger } from "@proxypilot/logger";
import { SESSION_COOKIE } from "@proxypilot/shared";
import { createHealthDispatcher } from "@proxypilot/worker/health-queue";
import { recordProxyHealth, startSystemWorker } from "@proxypilot/worker";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";

const config = loadConfig();
const key = decodeEncryptionKey(config.ENCRYPTION_KEY);
const logger = createLogger({ name: "health-integration", level: "silent" });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
const orgIds: string[] = [];
const thresholds = { healthyMin: config.HEALTHY_SCORE_MIN, degradedMin: config.DEGRADED_SCORE_MIN };

function app(enqueue: {
  enqueueCheck: (proxyId: string) => Promise<"queued" | "already">;
  enqueueRecovery: (proxyId: string, delayMs: number) => Promise<void>;
}) {
  return buildApp({
    logger,
    webOrigin: config.WEB_ORIGIN,
    nodeEnv: "test",
    auth: {
      sessionSecret: config.SESSION_SECRET,
      nodeEnv: "test",
      counter: redis,
      encryptionKey: key,
      health: {
        ...enqueue,
        cooldownSeconds: 60,
        thresholds,
      },
    },
    checks: {
      postgres: async () => {},
      redis: async () => {},
      workerHeartbeat: async () => null,
    },
  });
}

function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || !value.startsWith(`${SESSION_COOKIE}=`)) {
    throw new Error("session cookie missing");
  }
  return value.split(";")[0] ?? "";
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("stub proxy did not bind"));
        return;
      }
      resolve(address.port);
    });
  });
}

async function waitForStatus(proxyId: string, status: "SUCCESS" | "FAILED") {
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    const row = await getPrisma().healthCheck.findFirst({
      where: { proxyId, status },
      orderBy: { checkedAt: "desc" },
    });
    if (row) {
      return row;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`health check ${status} was not recorded`);
}

afterAll(async () => {
  const prisma = getPrisma();
  for (const id of orgIds) {
    await prisma.organization.delete({ where: { id } }).catch(() => undefined);
  }
  redis.disconnect();
  await disconnectDatabase();
});

describe("health checks", () => {
  it("queues a live probe, scores failures into quarantine, and recovers through degraded", async () => {
    const stub = createServer((_request, response) => {
      response.writeHead(204);
      response.end();
    });
    const port = await listen(stub);
    const dispatcher = createHealthDispatcher(config.REDIS_URL);
    const runtime = await startSystemWorker({
      redisUrl: config.REDIS_URL,
      queueName: `system-health-${process.pid}`,
      heartbeatKey: `worker:heartbeat:health:${process.pid}`,
      concurrency: 1,
      intervalMs: 0,
      health: {
        encryptionKey: key,
        targetUrl: "http://example.com/",
        timeoutMs: 2_000,
        intervalSeconds: 60,
        cooldownSeconds: 60,
        maxCooldownSeconds: 3_600,
        thresholds,
        checkConcurrency: 2,
        recoveryConcurrency: 1,
        schedule: false,
      },
    });
    const server = app(dispatcher);
    const stamp = randomUUID().slice(0, 8);
    const password = "correct-horse-battery";
    const proxyPassword = "phase4-secret";

    try {
      const owner = await server.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: `health-${stamp}@example.com`,
          password,
          name: "Owner",
          organizationName: `Health ${stamp}`,
        },
      });
      expect(owner.statusCode).toBe(201);
      const ownerCookie = cookieHeader(owner);
      orgIds.push(owner.json().data.user.organization.id);

      const viewer = await server.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: { cookie: ownerCookie },
        payload: { email: `viewer-health-${stamp}@example.com`, password, name: "Viewer", role: "VIEWER" },
      });
      expect(viewer.statusCode).toBe(201);
      const viewerLogin = await server.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: `viewer-health-${stamp}@example.com`, password },
      });
      const viewerCookie = cookieHeader(viewerLogin);

      const provider = await server.inject({
        method: "POST",
        url: "/api/v1/providers",
        headers: { cookie: ownerCookie },
        payload: { name: "Probe", type: "DATACENTER", protocol: "HTTP" },
      });
      const providerId = provider.json().data.provider.id as string;
      const created = await server.inject({
        method: "POST",
        url: "/api/v1/proxies",
        headers: { cookie: ownerCookie },
        payload: { providerId, host: "127.0.0.1", port, username: "ada", password: proxyPassword },
      });
      expect(created.statusCode).toBe(201);
      const proxyId = created.json().data.proxy.id as string;

      const denied = await server.inject({
        method: "POST",
        url: `/api/v1/proxies/${proxyId}/check`,
        headers: { cookie: viewerCookie },
      });
      expect(denied.statusCode).toBe(403);

      const queued = await server.inject({
        method: "POST",
        url: `/api/v1/proxies/${proxyId}/check`,
        headers: { cookie: ownerCookie },
      });
      expect(queued.statusCode).toBe(202);
      expect(queued.json().data.queued).toBe(true);

      const check = await waitForStatus(proxyId, "SUCCESS");
      expect(check.httpStatus).toBe(204);
      expect(check.errorMessage ?? "").not.toContain(proxyPassword);
      const probed = await getPrisma().proxy.findUniqueOrThrow({ where: { id: proxyId } });
      expect(probed.status).toBe("HEALTHY");
      expect(probed.healthScore).toBe(100);
      expect(probed.successCount).toBe(1);

      const other = await server.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: `other-health-${stamp}@example.com`,
          password,
          name: "Other",
          organizationName: `Other health ${stamp}`,
        },
      });
      orgIds.push(other.json().data.user.organization.id);
      const hidden = await server.inject({
        method: "GET",
        url: `/api/v1/health?proxyId=${proxyId}`,
        headers: { cookie: cookieHeader(other) },
      });
      expect(hidden.statusCode).toBe(404);

      const history = await server.inject({
        method: "GET",
        url: `/api/v1/health?proxyId=${proxyId}`,
        headers: { cookie: ownerCookie },
      });
      expect(history.statusCode).toBe(200);
      expect(history.json().data.checks[0].status).toBe("SUCCESS");
      expect(JSON.stringify(history.json())).not.toContain(proxyPassword);

      const scored = await server.inject({
        method: "POST",
        url: "/api/v1/proxies",
        headers: { cookie: ownerCookie },
        payload: { providerId, host: "203.0.113.10", port: 8080 },
      });
      const scoredId = scored.json().data.proxy.id as string;
      const failure = { kind: "connection_failure" as const, latencyMs: 12, errorCode: "CONNECTION_REFUSED", errorMessage: "refused" };
      await recordProxyHealth({ proxyId: scoredId, outcome: failure, cooldownSeconds: 60, maxCooldownSeconds: 3_600, thresholds });
      await recordProxyHealth({ proxyId: scoredId, outcome: failure, cooldownSeconds: 60, maxCooldownSeconds: 3_600, thresholds });
      const quarantined = await recordProxyHealth({
        proxyId: scoredId,
        outcome: failure,
        cooldownSeconds: 60,
        maxCooldownSeconds: 3_600,
        thresholds,
      });
      expect(quarantined?.status).toBe("QUARANTINED");
      const quarantinedRow = await getPrisma().proxy.findUniqueOrThrow({ where: { id: scoredId } });
      expect(quarantinedRow.healthScore).toBeLessThan(40);
      expect(quarantinedRow.cooldownUntil).toBeTruthy();
      const firstWindow = ((quarantinedRow.cooldownUntil?.getTime() ?? 0) - Date.now()) / 1000;
      expect(firstWindow).toBeGreaterThan(50);
      expect(firstWindow).toBeLessThan(70);

      await recordProxyHealth({ proxyId: scoredId, outcome: failure, cooldownSeconds: 60, maxCooldownSeconds: 3_600, thresholds });
      const doubled = await getPrisma().proxy.findUniqueOrThrow({ where: { id: scoredId } });
      const secondWindow = ((doubled.cooldownUntil?.getTime() ?? 0) - Date.now()) / 1000;
      expect(secondWindow).toBeGreaterThan(100);
      expect(secondWindow).toBeLessThan(130);

      const recovered = await recordProxyHealth({
        proxyId: scoredId,
        outcome: { kind: "success", latencyMs: 30, httpStatus: 204 },
        cooldownSeconds: 60,
        maxCooldownSeconds: 3_600,
        thresholds,
      });
      expect(recovered?.status).toBe("DEGRADED");
      expect(recovered?.healthScore).toBe(40);
      const recoveredRow = await getPrisma().proxy.findUniqueOrThrow({ where: { id: scoredId } });
      expect(recoveredRow.cooldownUntil).toBeNull();

      await getPrisma().proxy.update({ where: { id: scoredId }, data: { healthScore: 68, status: "DEGRADED" } });
      const restored = await recordProxyHealth({
        proxyId: scoredId,
        outcome: { kind: "success", latencyMs: 20, httpStatus: 200 },
        cooldownSeconds: 60,
        maxCooldownSeconds: 3_600,
        thresholds,
      });
      expect(restored).toMatchObject({ status: "HEALTHY", healthScore: 70 });

      const disabled = await server.inject({
        method: "POST",
        url: `/api/v1/proxies/${scoredId}/disable`,
        headers: { cookie: ownerCookie },
      });
      expect(disabled.json().data.proxy.status).toBe("DISABLED");
      const stillDisabled = await recordProxyHealth({
        proxyId: scoredId,
        outcome: failure,
        cooldownSeconds: 60,
        maxCooldownSeconds: 3_600,
        thresholds,
      });
      expect(stillDisabled?.status).toBe("DISABLED");
      expect(stillDisabled?.scheduleRecovery).toBe(false);

      await getPrisma().proxy.update({ where: { id: scoredId }, data: { healthScore: 20, status: "DISABLED", cooldownUntil: null } });
      const enabled = await server.inject({
        method: "POST",
        url: `/api/v1/proxies/${scoredId}/enable`,
        headers: { cookie: ownerCookie },
      });
      expect(enabled.json().data.proxy.status).toBe("QUARANTINED");
      expect(enabled.json().data.proxy.cooldownUntil).toBeTruthy();
    } finally {
      await runtime.close();
      await dispatcher.close();
      await new Promise<void>((resolve, reject) => stub.close((error) => (error ? reject(error) : resolve())));
      await server.close();
    }
  });
});
