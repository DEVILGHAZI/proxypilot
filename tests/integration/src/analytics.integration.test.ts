import { randomUUID } from "node:crypto";
import { buildApp } from "@proxypilot/api/app";
import { loadConfig } from "@proxypilot/config";
import { disconnectDatabase, getPrisma } from "@proxypilot/database";
import { createLogger } from "@proxypilot/logger";
import { SESSION_COOKIE } from "@proxypilot/shared";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";

const config = loadConfig();
const logger = createLogger({ name: "analytics-integration", level: "silent" });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
const orgIds: string[] = [];

function app() {
  return buildApp({
    logger,
    webOrigin: config.WEB_ORIGIN,
    nodeEnv: "test",
    auth: {
      sessionSecret: config.SESSION_SECRET,
      nodeEnv: "test",
      counter: redis,
      encryptionKey: Buffer.alloc(32),
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

describe("analytics", () => {
  it("summarizes organization health and scopes request counts by role", async () => {
    const server = app();
    const stamp = randomUUID().slice(0, 8);
    const password = "correct-horse-battery";
    const proxyPassword = "phase7-secret";
    try {
      const owner = await server.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: `dash-${stamp}@example.com`,
          password,
          name: "Owner",
          organizationName: `Dash ${stamp}`,
        },
      });
      expect(owner.statusCode).toBe(201);
      const ownerCookie = cookieHeader(owner);
      const ownerId = owner.json().data.user.id as string;
      const organizationId = owner.json().data.user.organization.id as string;
      orgIds.push(organizationId);

      const viewer = await server.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: { cookie: ownerCookie },
        payload: { email: `viewer-dash-${stamp}@example.com`, password, name: "Viewer", role: "VIEWER" },
      });
      expect(viewer.statusCode).toBe(201);
      const viewerLogin = await server.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: `viewer-dash-${stamp}@example.com`, password },
      });
      const viewerCookie = cookieHeader(viewerLogin);
      const viewerId = viewerLogin.json().data.user.id as string;

      const provider = await server.inject({
        method: "POST",
        url: "/api/v1/providers",
        headers: { cookie: ownerCookie },
        payload: { name: "Dash", type: "DATACENTER", protocol: "HTTP" },
      });
      const created = await server.inject({
        method: "POST",
        url: "/api/v1/proxies",
        headers: { cookie: ownerCookie },
        payload: {
          providerId: provider.json().data.provider.id,
          host: "10.8.8.8",
          port: 8080,
          password: proxyPassword,
        },
      });
      expect(created.statusCode).toBe(201);

      const prisma = getPrisma();
      await prisma.requestJob.createMany({
        data: [
          {
            organizationId,
            userId: ownerId,
            domain: "example.com",
            url: "https://example.com/a",
            method: "GET",
            status: "COMPLETED",
            httpStatus: 200,
            attempts: 1,
            latencyMs: 100,
            completedAt: new Date(),
          },
          {
            organizationId,
            userId: ownerId,
            domain: "example.com",
            url: "https://example.com/b",
            method: "GET",
            status: "COMPLETED",
            httpStatus: 200,
            attempts: 1,
            latencyMs: 300,
            completedAt: new Date(),
          },
          {
            organizationId,
            userId: viewerId,
            domain: "other.test",
            url: "https://other.test/c",
            method: "GET",
            status: "FAILED",
            httpStatus: 500,
            attempts: 2,
            latencyMs: 400,
            errorCode: "HTTP_5XX",
            completedAt: new Date(),
          },
        ],
      });

      const anon = await server.inject({ method: "GET", url: "/api/v1/analytics" });
      expect(anon.statusCode).toBe(401);

      const organization = await server.inject({
        method: "GET",
        url: "/api/v1/analytics?hours=24",
        headers: { cookie: ownerCookie },
      });
      expect(organization.statusCode).toBe(200);
      const body = organization.json();
      expect(JSON.stringify(body)).not.toContain(proxyPassword);
      expect(body.data.analytics.scope).toBe("organization");
      expect(body.data.analytics.proxies.healthy).toBeGreaterThanOrEqual(1);
      expect(body.data.analytics.requests).toMatchObject({ total: 3, completed: 2, failed: 1, avgLatencyMs: 267 });
      expect(body.data.analytics.domains[0]).toMatchObject({ domain: "example.com", count: 2 });
      expect(body.data.analytics.recent).toHaveLength(3);
      expect(body.data.analytics.recent.some((row: { url?: string }) => "url" in row)).toBe(false);
      const hourCompleted = body.data.analytics.hours.reduce(
        (sum: number, hour: { completed: number }) => sum + hour.completed,
        0,
      );
      expect(hourCompleted).toBe(2);

      const own = await server.inject({
        method: "GET",
        url: "/api/v1/analytics",
        headers: { cookie: viewerCookie },
      });
      expect(own.statusCode).toBe(200);
      expect(own.json().data.analytics.scope).toBe("user");
      expect(own.json().data.analytics.requests).toMatchObject({ total: 1, completed: 0, failed: 1 });
      expect(own.json().data.analytics.domains).toEqual([{ domain: "other.test", count: 1, avgLatencyMs: 400 }]);
      expect(own.json().data.analytics.proxies.total).toBeGreaterThanOrEqual(1);
    } finally {
      await server.close();
    }
  });
});
