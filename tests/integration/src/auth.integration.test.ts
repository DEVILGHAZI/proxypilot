import { randomUUID } from "node:crypto";
import { buildApp } from "@proxypilot/api/app";
import { loadConfig } from "@proxypilot/config";
import { decodeEncryptionKey, disconnectDatabase, getPrisma } from "@proxypilot/database";
import { createLogger } from "@proxypilot/logger";
import { SESSION_COOKIE } from "@proxypilot/shared";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";

const config = loadConfig();
const logger = createLogger({ name: "auth-integration", level: "silent" });
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
      encryptionKey: decodeEncryptionKey(config.ENCRYPTION_KEY),
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

describe("auth and api keys", () => {
  it("registers, enforces roles, and stores only a hash of the api key", async () => {
    if (redis.status !== "ready") {
      await redis.connect();
    }
    const server = app();
    const stamp = randomUUID();
    const ownerEmail = `owner-${stamp}@example.com`;
    const viewerEmail = `viewer-${stamp}@example.com`;
    const password = "correct-horse-battery";

    const registered = await server.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: ownerEmail,
        password,
        name: "Owner",
        organizationName: `Acme ${stamp.slice(0, 8)}`,
      },
    });
    expect(registered.statusCode).toBe(201);
    const owner = registered.json().data.user;
    orgIds.push(owner.organization.id);
    expect(owner.role).toBe("OWNER");
    const ownerCookie = cookieHeader(registered);

    const me = await server.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: ownerCookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.user.email).toBe(ownerEmail);

    const createdViewer = await server.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { cookie: ownerCookie },
      payload: { email: viewerEmail, password, name: "Viewer", role: "VIEWER" },
    });
    expect(createdViewer.statusCode).toBe(201);

    const demote = await server.inject({
      method: "PATCH",
      url: `/api/v1/users/${owner.id}`,
      headers: { cookie: ownerCookie },
      payload: { role: "MEMBER" },
    });
    expect(demote.statusCode).toBe(403);

    const viewerLogin = await server.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: viewerEmail, password },
    });
    expect(viewerLogin.statusCode).toBe(200);
    const viewerCookie = cookieHeader(viewerLogin);

    const viewerKey = await server.inject({
      method: "POST",
      url: "/api/v1/api-keys",
      headers: { cookie: viewerCookie },
      payload: { name: "viewer" },
    });
    expect(viewerKey.statusCode).toBe(403);

    const viewerPatch = await server.inject({
      method: "PATCH",
      url: `/api/v1/users/${owner.id}`,
      headers: { cookie: viewerCookie },
      payload: { role: "ADMIN" },
    });
    expect(viewerPatch.statusCode).toBe(403);

    const issued = await server.inject({
      method: "POST",
      url: "/api/v1/api-keys",
      headers: { cookie: ownerCookie },
      payload: { name: "ci" },
    });
    expect(issued.statusCode).toBe(201);
    const secret = issued.json().data.secret as string;
    const keyId = issued.json().data.key.id as string;
    expect(secret.startsWith("pp_live_")).toBe(true);

    const prisma = getPrisma();
    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: keyId } });
    expect(stored.keyHash).not.toContain(secret);
    expect(stored.prefix).toBe(secret.slice(0, "pp_live_".length + 8));

    const listed = await server.inject({
      method: "GET",
      url: "/api/v1/api-keys",
      headers: { cookie: ownerCookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(JSON.stringify(listed.json())).not.toContain(secret);

    const bearer = await server.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(bearer.statusCode).toBe(200);
    expect(bearer.json().data.apiKeyId).toBe(keyId);

    const revoked = await server.inject({
      method: "POST",
      url: `/api/v1/api-keys/${keyId}/revoke`,
      headers: { cookie: ownerCookie },
    });
    expect(revoked.statusCode).toBe(200);
    const after = await server.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(after.statusCode).toBe(401);

    const loggedOut = await server.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: ownerCookie },
    });
    expect(loggedOut.statusCode).toBe(200);
    const again = await server.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: ownerCookie },
    });
    expect(again.statusCode).toBe(401);

    await server.close();
  }, 30_000);

  it("rejects duplicate emails and wrong passwords", async () => {
    const server = app();
    const email = `dup-${randomUUID()}@example.com`;
    const payload = {
      email,
      password: "correct-horse-battery",
      name: "Owner",
      organizationName: `Org ${email.slice(0, 12)}`,
    };
    const first = await server.inject({ method: "POST", url: "/api/v1/auth/register", payload });
    expect(first.statusCode).toBe(201);
    orgIds.push(first.json().data.user.organization.id);
    const second = await server.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { ...payload, organizationName: `Org ${email.slice(0, 12)} b` },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("EMAIL_IN_USE");

    const bad = await server.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: "not-the-password" },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe("INVALID_CREDENTIALS");
    await server.close();
  }, 30_000);
});
