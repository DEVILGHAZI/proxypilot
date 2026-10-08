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
const logger = createLogger({ name: "security-integration", level: "silent" });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
const orgIds: string[] = [];

function app(queued: { count: number }) {
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
        enqueue: async () => {
          queued.count += 1;
        },
        takeSlot: async () => true,
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

afterAll(async () => {
  const prisma = getPrisma();
  for (const id of orgIds) {
    await prisma.organization.delete({ where: { id } }).catch(() => undefined);
  }
  redis.disconnect();
  await disconnectDatabase();
});

describe("security", () => {
  it("enforces roles, hides secrets in the audit log, and blocks encoded local targets", async () => {
    const queued = { count: 0 };
    const server = app(queued);
    const stamp = randomUUID().slice(0, 8);
    const password = "correct-horse-battery";
    const proxyPassword = "phase8-secret";
    try {
      const owner = await server.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: `secure-${stamp}@example.com`,
          password,
          name: "Owner",
          organizationName: `Secure ${stamp}`,
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
        payload: { email: `viewer-secure-${stamp}@example.com`, password, name: "Viewer", role: "VIEWER" },
      });
      const member = await server.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: { cookie: ownerCookie },
        payload: { email: `member-secure-${stamp}@example.com`, password, name: "Member", role: "MEMBER" },
      });
      expect(viewer.statusCode).toBe(201);
      expect(member.statusCode).toBe(201);
      const viewerLogin = await server.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: `viewer-secure-${stamp}@example.com`, password },
      });
      const memberLogin = await server.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: `member-secure-${stamp}@example.com`, password },
      });
      const viewerCookie = cookieHeader(viewerLogin);
      const memberCookie = cookieHeader(memberLogin);

      const deniedProvider = await server.inject({
        method: "POST",
        url: "/api/v1/providers",
        headers: { cookie: viewerCookie },
        payload: { name: "Blocked", type: "DATACENTER", protocol: "HTTP" },
      });
      expect(deniedProvider.statusCode).toBe(403);

      const provider = await server.inject({
        method: "POST",
        url: "/api/v1/providers",
        headers: { cookie: ownerCookie },
        payload: { name: "Secure", type: "DATACENTER", protocol: "HTTP" },
      });
      const providerId = provider.json().data.provider.id as string;
      const created = await server.inject({
        method: "POST",
        url: "/api/v1/proxies",
        headers: { cookie: memberCookie },
        payload: { providerId, host: "10.9.9.9", port: 8080, password: proxyPassword },
      });
      expect(created.statusCode).toBe(201);
      const proxyId = created.json().data.proxy.id as string;
      expect(JSON.stringify(created.json())).not.toContain(proxyPassword);

      const memberDelete = await server.inject({
        method: "DELETE",
        url: `/api/v1/proxies/${proxyId}`,
        headers: { cookie: memberCookie },
      });
      expect(memberDelete.statusCode).toBe(403);
      const viewerDelete = await server.inject({
        method: "DELETE",
        url: `/api/v1/proxies/${proxyId}`,
        headers: { cookie: viewerCookie },
      });
      expect(viewerDelete.statusCode).toBe(403);

      const outsider = await server.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: `other-secure-${stamp}@example.com`,
          password,
          name: "Other",
          organizationName: `Other secure ${stamp}`,
        },
      });
      orgIds.push(outsider.json().data.user.organization.id);
      const missing = await server.inject({
        method: "DELETE",
        url: `/api/v1/proxies/${proxyId}`,
        headers: { cookie: cookieHeader(outsider) },
      });
      expect(missing.statusCode).toBe(404);

      await getPrisma().auditLog.create({
        data: {
          organizationId,
          userId: ownerId,
          action: "SETTINGS_CHANGED",
          resource: "proxy",
          resourceId: proxyId,
          metadata: { host: "10.9.9.9", password: proxyPassword, note: "http://ada:hidden@10.9.9.9/path" },
        },
      });

      const viewerAudit = await server.inject({
        method: "GET",
        url: "/api/v1/audit",
        headers: { cookie: viewerCookie },
      });
      expect(viewerAudit.statusCode).toBe(403);

      const audit = await server.inject({
        method: "GET",
        url: "/api/v1/audit?limit=20",
        headers: { cookie: ownerCookie },
      });
      expect(audit.statusCode).toBe(200);
      const body = JSON.stringify(audit.json());
      expect(body).not.toContain(proxyPassword);
      expect(body).not.toContain("hidden");
      const actions = audit.json().data.events.map((event: { action: string }) => event.action);
      expect(actions).toContain("PROXY_CREATED");
      expect(actions).toContain("PROVIDER_CREATED");

      const otherAudit = await server.inject({
        method: "GET",
        url: "/api/v1/audit",
        headers: { cookie: cookieHeader(outsider) },
      });
      expect(otherAudit.statusCode).toBe(200);
      expect(otherAudit.json().data.events.map((event: { resourceId: string | null }) => event.resourceId)).not.toContain(proxyId);

      for (const url of ["http://127.1/latest", "http://0x7f000001/", "http://0177.0.0.1/"]) {
        const blocked = await server.inject({
          method: "POST",
          url: "/api/v1/pools/missing/requests",
          headers: { cookie: ownerCookie },
          payload: { url, method: "GET" },
        });
        expect(blocked.statusCode).toBe(400);
        expect(blocked.json().error.code).toBe("TARGET_BLOCKED");
      }
      expect(queued.count).toBe(0);
    } finally {
      await server.close();
    }
  });
});
