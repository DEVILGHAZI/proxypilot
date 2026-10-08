import { randomUUID } from "node:crypto";
import { buildApp } from "@proxypilot/api/app";
import { loadConfig } from "@proxypilot/config";
import { decodeEncryptionKey, disconnectDatabase, getPrisma } from "@proxypilot/database";
import { createLogger } from "@proxypilot/logger";
import { SESSION_COOKIE } from "@proxypilot/shared";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";

const config = loadConfig();
const key = decodeEncryptionKey(config.ENCRYPTION_KEY);
const logger = createLogger({ name: "rotation-integration", level: "silent" });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
const orgIds: string[] = [];
const cursors = new Map<string, number>();

function app() {
  return buildApp({
    logger,
    webOrigin: config.WEB_ORIGIN,
    nodeEnv: "test",
    auth: {
      sessionSecret: config.SESSION_SECRET,
      nodeEnv: "test",
      counter: redis,
      encryptionKey: key,
      nextCursor: async (organizationId, poolId) => {
        const cursorKey = `${organizationId}:${poolId}`;
        const next = (cursors.get(cursorKey) ?? 0) + 1;
        cursors.set(cursorKey, next);
        return next;
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

afterAll(async () => {
  const prisma = getPrisma();
  for (const id of orgIds) {
    await prisma.organization.delete({ where: { id } }).catch(() => undefined);
  }
  redis.disconnect();
  await disconnectDatabase();
});

describe("rotation", () => {
  it("selects eligible proxies, walks round robin, and reuses a sticky session", async () => {
    const server = app();
    const stamp = randomUUID().slice(0, 8);
    const password = "correct-horse-battery";
    try {
      const owner = await server.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: `rotate-${stamp}@example.com`,
          password,
          name: "Owner",
          organizationName: `Rotate ${stamp}`,
        },
      });
      expect(owner.statusCode).toBe(201);
      const ownerCookie = cookieHeader(owner);
      orgIds.push(owner.json().data.user.organization.id);

      const viewer = await server.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: { cookie: ownerCookie },
        payload: { email: `viewer-rotate-${stamp}@example.com`, password, name: "Viewer", role: "VIEWER" },
      });
      expect(viewer.statusCode).toBe(201);
      const viewerLogin = await server.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: `viewer-rotate-${stamp}@example.com`, password },
      });
      const viewerCookie = cookieHeader(viewerLogin);
      const denied = await server.inject({
        method: "POST",
        url: "/api/v1/policies",
        headers: { cookie: viewerCookie },
        payload: {
          name: "Blocked",
          strategy: "ROUND_ROBIN",
          timeoutMs: 30_000,
          maxRetries: 3,
          cooldownSeconds: 60,
          sessionTtlSeconds: 600,
          maxConcurrency: 10,
          requestsPerSecond: 10,
        },
      });
      expect(denied.statusCode).toBe(403);

      const provider = await server.inject({
        method: "POST",
        url: "/api/v1/providers",
        headers: { cookie: ownerCookie },
        payload: { name: "Rotate", type: "DATACENTER", protocol: "HTTP" },
      });
      const providerId = provider.json().data.provider.id as string;
      const hosts = ["10.1.1.1", "10.1.1.2", "10.1.1.3", "10.1.1.4"];
      const created = [];
      for (const host of hosts) {
        const response = await server.inject({
          method: "POST",
          url: "/api/v1/proxies",
          headers: { cookie: ownerCookie },
          payload: { providerId, host, port: 8080 },
        });
        expect(response.statusCode).toBe(201);
        created.push(response.json().data.proxy.id as string);
      }
      const [healthyA, healthyB, disabledId, quarantinedId] = created;
      await getPrisma().proxy.update({ where: { id: disabledId }, data: { status: "DISABLED" } });
      await getPrisma().proxy.update({
        where: { id: quarantinedId },
        data: { status: "QUARANTINED", healthScore: 10, cooldownUntil: new Date(Date.now() + 60_000) },
      });

      const pool = await server.inject({
        method: "POST",
        url: "/api/v1/pools",
        headers: { cookie: ownerCookie },
        payload: { name: "Ring", strategy: "ROUND_ROBIN" },
      });
      const poolId = pool.json().data.pool.id as string;
      await server.inject({
        method: "PUT",
        url: `/api/v1/pools/${poolId}/proxies`,
        headers: { cookie: ownerCookie },
        payload: { proxyIds: created },
      });

      const first = await server.inject({
        method: "POST",
        url: `/api/v1/pools/${poolId}/select`,
        headers: { cookie: ownerCookie },
      });
      const second = await server.inject({
        method: "POST",
        url: `/api/v1/pools/${poolId}/select`,
        headers: { cookie: ownerCookie },
      });
      const third = await server.inject({
        method: "POST",
        url: `/api/v1/pools/${poolId}/select`,
        headers: { cookie: ownerCookie },
      });
      expect(first.statusCode).toBe(200);
      const eligible = [healthyA, healthyB].sort();
      expect(first.json().data.selection.proxy.id).toBe(eligible[0]);
      expect(second.json().data.selection.proxy.id).toBe(eligible[1]);
      expect(third.json().data.selection.proxy.id).toBe(eligible[0]);
      expect(JSON.stringify(first.json())).not.toContain("password");
      expect([disabledId, quarantinedId]).not.toContain(first.json().data.selection.proxy.id);

      const policy = await server.inject({
        method: "POST",
        url: "/api/v1/policies",
        headers: { cookie: ownerCookie },
        payload: {
          name: "Stick",
          strategy: "STICKY_SESSION",
          timeoutMs: 30_000,
          maxRetries: 2,
          cooldownSeconds: 60,
          sessionTtlSeconds: 600,
          maxConcurrency: 4,
          requestsPerSecond: 5,
        },
      });
      expect(policy.statusCode).toBe(201);
      const policyId = policy.json().data.policy.id as string;
      const stickyPool = await server.inject({
        method: "POST",
        url: "/api/v1/pools",
        headers: { cookie: ownerCookie },
        payload: { name: "Sticky", strategy: "STICKY_SESSION", policyId },
      });
      const stickyId = stickyPool.json().data.pool.id as string;
      await server.inject({
        method: "PUT",
        url: `/api/v1/pools/${stickyId}/proxies`,
        headers: { cookie: ownerCookie },
        payload: { proxyIds: [healthyA, healthyB] },
      });
      const bound = await server.inject({
        method: "POST",
        url: `/api/v1/pools/${stickyId}/select`,
        headers: { cookie: ownerCookie },
      });
      const again = await server.inject({
        method: "POST",
        url: `/api/v1/pools/${stickyId}/select`,
        headers: { cookie: ownerCookie },
      });
      expect(again.json().data.selection.proxy.id).toBe(bound.json().data.selection.proxy.id);
      expect(again.json().data.selection.session.id).toBe(bound.json().data.selection.session.id);

      await getPrisma().proxy.update({
        where: { id: bound.json().data.selection.proxy.id as string },
        data: { status: "DISABLED" },
      });
      const rebound = await server.inject({
        method: "POST",
        url: `/api/v1/pools/${stickyId}/select`,
        headers: { cookie: ownerCookie },
      });
      expect(rebound.json().data.selection.proxy.id).not.toBe(bound.json().data.selection.proxy.id);
      expect(rebound.json().data.selection.session.id).toBe(bound.json().data.selection.session.id);

      const other = await server.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: `other-rotate-${stamp}@example.com`,
          password,
          name: "Other",
          organizationName: `Other rotate ${stamp}`,
        },
      });
      orgIds.push(other.json().data.user.organization.id);
      const hidden = await server.inject({
        method: "POST",
        url: `/api/v1/pools/${poolId}/select`,
        headers: { cookie: cookieHeader(other) },
      });
      expect(hidden.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});