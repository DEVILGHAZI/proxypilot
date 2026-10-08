import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { buildApp } from "@proxypilot/api/app";
import { loadConfig } from "@proxypilot/config";
import { decodeEncryptionKey, disconnectDatabase, getPrisma } from "@proxypilot/database";
import { createLogger } from "@proxypilot/logger";
import { SESSION_COOKIE, rateWindowKey } from "@proxypilot/shared";
import { createRequestDispatcher } from "@proxypilot/worker/request-queue";
import { startSystemWorker } from "@proxypilot/worker";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";

const config = loadConfig();
const key = decodeEncryptionKey(config.ENCRYPTION_KEY);
const logger = createLogger({ name: "request-integration", level: "silent" });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
const orgIds: string[] = [];

function app(dispatcher: { enqueue: (job: { requestId: string; poolId: string; body: string | null }) => Promise<unknown> }) {
  return buildApp({
    logger,
    webOrigin: config.WEB_ORIGIN,
    nodeEnv: "test",
    auth: {
      sessionSecret: config.SESSION_SECRET,
      nodeEnv: "test",
      counter: redis,
      encryptionKey: key,
      requests: {
        enqueue: dispatcher.enqueue,
        takeSlot: async (slotKey, limit) => {
          const count = await redis.incr(slotKey);
          if (count === 1) {
            await redis.expire(slotKey, 2);
          }
          return count <= limit;
        },
        limits: { org: 100, user: 30, apiKey: 30, domain: 20 },
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

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function waitForTerminal(requestId: string) {
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    const row = await getPrisma().requestJob.findUnique({ where: { id: requestId } });
    if (row && (row.status === "COMPLETED" || row.status === "FAILED" || row.status === "CANCELLED")) {
      return row;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`request ${requestId} did not finish`);
}

afterAll(async () => {
  const prisma = getPrisma();
  for (const id of orgIds) {
    await prisma.organization.delete({ where: { id } }).catch(() => undefined);
  }
  redis.disconnect();
  await disconnectDatabase();
});

describe("request engine", () => {
  it("forwards through a proxy, retries a 500, keeps a 401, and enforces limits", async () => {
    const okProxy = createServer((_request, response) => {
      response.writeHead(200);
      response.end("ok");
    });
    const deniedProxy = createServer((_request, response) => {
      response.writeHead(401);
      response.end();
    });
    const failProxy = createServer((_request, response) => {
      response.writeHead(500);
      response.end();
    });
    const [okPort, deniedPort, failPort] = await Promise.all([listen(okProxy), listen(deniedProxy), listen(failProxy)]);
    const dispatcher = createRequestDispatcher(config.REDIS_URL);
    const runtime = await startSystemWorker({
      redisUrl: config.REDIS_URL,
      queueName: `system-request-${process.pid}`,
      heartbeatKey: `worker:heartbeat:request:${process.pid}`,
      concurrency: 1,
      intervalMs: 0,
      requests: { encryptionKey: key, concurrency: 2 },
    });
    const server = app(dispatcher);
    const stamp = randomUUID().slice(0, 8);
    const password = "correct-horse-battery";
    const proxyPassword = "phase6-secret";

    try {
      const owner = await server.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: `request-${stamp}@example.com`,
          password,
          name: "Owner",
          organizationName: `Requests ${stamp}`,
        },
      });
      expect(owner.statusCode).toBe(201);
      const ownerCookie = cookieHeader(owner);
      const organizationId = owner.json().data.user.organization.id as string;
      orgIds.push(organizationId);

      const viewer = await server.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: { cookie: ownerCookie },
        payload: { email: `viewer-request-${stamp}@example.com`, password, name: "Viewer", role: "VIEWER" },
      });
      expect(viewer.statusCode).toBe(201);
      const viewerLogin = await server.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: `viewer-request-${stamp}@example.com`, password },
      });
      const viewerCookie = cookieHeader(viewerLogin);

      const provider = await server.inject({
        method: "POST",
        url: "/api/v1/providers",
        headers: { cookie: ownerCookie },
        payload: { name: "Forward", type: "DATACENTER", protocol: "HTTP" },
      });
      const providerId = provider.json().data.provider.id as string;

      async function makeProxy(port: number) {
        const response = await server.inject({
          method: "POST",
          url: "/api/v1/proxies",
          headers: { cookie: ownerCookie },
          payload: { providerId, host: "127.0.0.1", port, username: "ada", password: proxyPassword },
        });
        expect(response.statusCode).toBe(201);
        return response.json().data.proxy.id as string;
      }

      async function makePolicy(name: string, maxRetries: number, requestsPerSecond: number, maxConcurrency: number) {
        const response = await server.inject({
          method: "POST",
          url: "/api/v1/policies",
          headers: { cookie: ownerCookie },
          payload: {
            name,
            strategy: "ROUND_ROBIN",
            timeoutMs: 5_000,
            maxRetries,
            cooldownSeconds: 60,
            sessionTtlSeconds: 600,
            maxConcurrency,
            requestsPerSecond,
          },
        });
        expect(response.statusCode).toBe(201);
        return response.json().data.policy.id as string;
      }

      async function makePool(name: string, policyId: string, proxyId: string) {
        const response = await server.inject({
          method: "POST",
          url: "/api/v1/pools",
          headers: { cookie: ownerCookie },
          payload: { name, strategy: "ROUND_ROBIN", policyId },
        });
        expect(response.statusCode).toBe(201);
        const poolId = response.json().data.pool.id as string;
        const members = await server.inject({
          method: "PUT",
          url: `/api/v1/pools/${poolId}/proxies`,
          headers: { cookie: ownerCookie },
          payload: { proxyIds: [proxyId] },
        });
        expect(members.statusCode).toBe(200);
        return poolId;
      }

      const okPool = await makePool("Open", await makePolicy(`Open ${stamp}`, 0, 10, 4), await makeProxy(okPort));
      const retryPolicy = await makePolicy(`Retry ${stamp}`, 1, 10, 2);
      const failPool = await makePool("Retry", retryPolicy, await makeProxy(failPort));
      const deniedPolicy = await makePolicy(`Denied ${stamp}`, 3, 10, 1);
      const deniedPool = await makePool("Denied", deniedPolicy, await makeProxy(deniedPort));

      const blocked = await server.inject({
        method: "POST",
        url: `/api/v1/pools/${okPool}/requests`,
        headers: { cookie: viewerCookie },
        payload: { url: "http://127.0.0.1/latest", method: "GET" },
      });
      expect(blocked.statusCode).toBe(400);
      expect(blocked.json().error.code).toBe("TARGET_BLOCKED");
      expect(JSON.stringify(blocked.json())).not.toContain(proxyPassword);

      const sent = await server.inject({
        method: "POST",
        url: `/api/v1/pools/${okPool}/requests`,
        headers: { cookie: viewerCookie },
        payload: { url: "http://example.com/phase6", method: "GET" },
      });
      expect(sent.statusCode).toBe(202);
      expect(JSON.stringify(sent.json())).not.toContain(proxyPassword);
      const requestId = sent.json().data.request.id as string;
      const completed = await waitForTerminal(requestId);
      expect(completed.status).toBe("COMPLETED");
      expect(completed.httpStatus).toBe(200);
      expect(completed.attempts).toBe(1);

      const detail = await server.inject({
        method: "GET",
        url: `/api/v1/requests/${requestId}`,
        headers: { cookie: viewerCookie },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.attemptLog).toHaveLength(1);
      expect(JSON.stringify(detail.json())).not.toContain(proxyPassword);

      const meter = await getPrisma().usageMeter.findFirst({
        where: { organizationId, metric: "requests" },
      });
      expect(meter?.quantity).toBe(1n);

      const firstLimited = await server.inject({
        method: "POST",
        url: `/api/v1/pools/${failPool}/requests`,
        headers: { cookie: ownerCookie },
        payload: { url: "http://example.com/down", method: "GET" },
      });
      expect(firstLimited.statusCode).toBe(202);
      const retried = await waitForTerminal(firstLimited.json().data.request.id as string);
      expect(retried.status).toBe("FAILED");
      expect(retried.httpStatus).toBe(500);
      expect(retried.attempts).toBe(2);

      await redis.set(rateWindowKey("policy", retryPolicy), "10", "EX", 5);
      const secondLimited = await server.inject({
        method: "POST",
        url: `/api/v1/pools/${failPool}/requests`,
        headers: { cookie: ownerCookie },
        payload: { url: "http://example.com/down-again", method: "GET" },
      });
      expect(secondLimited.statusCode).toBe(429);
      expect(secondLimited.json().error.code).toBe("RATE_LIMITED");

      const placeholder = await getPrisma().requestJob.create({
        data: {
          organizationId,
          userId: owner.json().data.user.id,
          policyId: deniedPolicy,
          domain: "example.com",
          url: "http://example.com/hold",
          method: "GET",
          status: "RUNNING",
        },
      });
      const crowded = await server.inject({
        method: "POST",
        url: `/api/v1/pools/${deniedPool}/requests`,
        headers: { cookie: ownerCookie },
        payload: { url: "http://example.com/denied", method: "GET" },
      });
      expect(crowded.statusCode).toBe(429);
      expect(crowded.json().error.code).toBe("CONCURRENCY_LIMIT");
      await getPrisma().requestJob.delete({ where: { id: placeholder.id } });

      const denied = await server.inject({
        method: "POST",
        url: `/api/v1/pools/${deniedPool}/requests`,
        headers: { cookie: ownerCookie },
        payload: { url: "http://example.com/denied", method: "GET" },
      });
      expect(denied.statusCode).toBe(202);
      const kept = await waitForTerminal(denied.json().data.request.id as string);
      expect(kept.status).toBe("COMPLETED");
      expect(kept.httpStatus).toBe(401);
      expect(kept.attempts).toBe(1);

      const outsider = await server.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: `other-request-${stamp}@example.com`,
          password,
          name: "Other",
          organizationName: `Other ${stamp}`,
        },
      });
      orgIds.push(outsider.json().data.user.organization.id);
      const missing = await server.inject({
        method: "POST",
        url: `/api/v1/pools/${okPool}/requests`,
        headers: { cookie: cookieHeader(outsider) },
        payload: { url: "http://example.com/", method: "GET" },
      });
      expect(missing.statusCode).toBe(404);
    } finally {
      await runtime.close();
      await dispatcher.close();
      await server.close();
      await Promise.all([closeServer(okProxy), closeServer(deniedProxy), closeServer(failProxy)]);
    }
  });
});
