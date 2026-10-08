import { randomUUID } from "node:crypto";
import { buildApp } from "@proxypilot/api/app";
import { loadConfig } from "@proxypilot/config";
import { decodeEncryptionKey, decryptString, disconnectDatabase, getPrisma } from "@proxypilot/database";
import { createLogger } from "@proxypilot/logger";
import { SESSION_COOKIE } from "@proxypilot/shared";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";

const config = loadConfig();
const key = decodeEncryptionKey(config.ENCRYPTION_KEY);
const logger = createLogger({ name: "inventory-integration", level: "silent" });
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
      encryptionKey: key,
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

describe("inventory", () => {
  it("stores encrypted proxy credentials, imports lines, and keeps pools inside the organization", async () => {
    const server = app();
    const stamp = randomUUID().slice(0, 8);
    const password = "correct-horse-battery";
    const owner = await server.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: `owner-${stamp}@example.com`,
        password,
        name: "Owner",
        organizationName: `Inventory ${stamp}`,
      },
    });
    expect(owner.statusCode).toBe(201);
    const ownerCookie = cookieHeader(owner);
    orgIds.push(owner.json().data.user.organization.id);

    const viewer = await server.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { cookie: ownerCookie },
      payload: {
        email: `viewer-${stamp}@example.com`,
        password,
        name: "Viewer",
        role: "VIEWER",
      },
    });
    expect(viewer.statusCode).toBe(201);
    const viewerLogin = await server.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: `viewer-${stamp}@example.com`, password },
    });
    const viewerCookie = cookieHeader(viewerLogin);

    const denied = await server.inject({
      method: "POST",
      url: "/api/v1/providers",
      headers: { cookie: viewerCookie },
      payload: { name: "Blocked", type: "CUSTOM", protocol: "HTTP" },
    });
    expect(denied.statusCode).toBe(403);

    const provider = await server.inject({
      method: "POST",
      url: "/api/v1/providers",
      headers: { cookie: ownerCookie },
      payload: {
        name: "Edge",
        type: "DATACENTER",
        protocol: "HTTP",
        username: "gateway",
        password: "provider-secret",
      },
    });
    expect(provider.statusCode).toBe(201);
    const providerId = provider.json().data.provider.id as string;
    expect(provider.json().data.provider.hasCredentials).toBe(true);
    expect(JSON.stringify(provider.json())).not.toContain("provider-secret");

    const created = await server.inject({
      method: "POST",
      url: "/api/v1/proxies",
      headers: { cookie: ownerCookie },
      payload: {
        providerId,
        host: "proxy.example",
        port: 8000,
        username: "ada",
        password: "proxy-secret",
        country: "US",
        tagNames: ["primary"],
      },
    });
    expect(created.statusCode).toBe(201);
    const proxy = created.json().data.proxy;
    expect(proxy.hasPassword).toBe(true);
    expect(proxy.tags).toEqual(["primary"]);
    expect(JSON.stringify(created.json())).not.toContain("proxy-secret");

    const stored = await getPrisma().proxy.findUniqueOrThrow({ where: { id: proxy.id as string } });
    expect(stored.passwordEncrypted).not.toContain("proxy-secret");
    expect(decryptString(stored.passwordEncrypted ?? "", key)).toBe("proxy-secret");
    const storedProvider = await getPrisma().provider.findUniqueOrThrow({ where: { id: providerId } });
    expect(decryptString(storedProvider.credentialsEncrypted ?? "", key)).toContain("provider-secret");

    const imported = await server.inject({
      method: "POST",
      url: "/api/v1/proxies/import",
      headers: { cookie: ownerCookie },
      payload: {
        providerId,
        text: "user:import-secret@10.2.2.2:9000\nproxy.example:8000\n",
      },
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().data.created).toBe(1);
    expect(imported.json().data.skipped).toBe(1);
    expect(JSON.stringify(imported.json())).not.toContain("import-secret");

    const pool = await server.inject({
      method: "POST",
      url: "/api/v1/pools",
      headers: { cookie: ownerCookie },
      payload: { name: "Primary", strategy: "STICKY_SESSION" },
    });
    expect(pool.statusCode).toBe(201);
    const assigned = await server.inject({
      method: "PUT",
      url: `/api/v1/pools/${pool.json().data.pool.id}/proxies`,
      headers: { cookie: ownerCookie },
      payload: { proxyIds: [proxy.id] },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().data.pool.proxyIds).toEqual([proxy.id]);

    const listed = await server.inject({
      method: "GET",
      url: "/api/v1/proxies?tag=primary",
      headers: { cookie: ownerCookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.proxies).toHaveLength(1);

    const other = await server.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: `other-${stamp}@example.com`,
        password,
        name: "Other",
        organizationName: `Other ${stamp}`,
      },
    });
    orgIds.push(other.json().data.user.organization.id);
    const foreign = await server.inject({
      method: "GET",
      url: "/api/v1/proxies",
      headers: { cookie: cookieHeader(other) },
    });
    expect(foreign.json().data.proxies).toEqual([]);

    await server.close();
  }, 30_000);
});
