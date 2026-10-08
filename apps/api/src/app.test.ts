import { createLogger } from "@proxypilot/logger";
import { describe, expect, it } from "vitest";
import { buildApp, type DependencyChecks } from "./app.js";

const logger = createLogger({ name: "api-test", level: "silent" });

function checks(overrides: Partial<DependencyChecks> = {}): DependencyChecks {
  return {
    postgres: async () => {},
    redis: async () => {},
    workerHeartbeat: async () => null,
    ...overrides,
  };
}

describe("api foundation", () => {
  it("reports liveness without dependencies", async () => {
    const app = buildApp({
      logger,
      webOrigin: "http://localhost:3000",
      nodeEnv: "test",
      checks: checks(),
    });
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "req_healthcheck01" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe("req_healthcheck01");
    expect(response.json()).toMatchObject({
      success: true,
      requestId: "req_healthcheck01",
      data: { status: "ok", service: "proxypilot-api" },
    });
    await app.close();
  });

  it("returns the version payload", async () => {
    const app = buildApp({
      logger,
      webOrigin: "http://localhost:3000",
      nodeEnv: "test",
      checks: checks(),
    });
    const response = await app.inject({ method: "GET", url: "/api/v1" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      name: "proxypilot",
      version: "0.1.0",
      apiVersion: "v1",
    });
    await app.close();
  });

  it("serves the OpenAPI contract", async () => {
    const app = buildApp({
      logger,
      webOrigin: "http://localhost:3000",
      nodeEnv: "test",
      checks: checks(),
    });
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=300");
    expect(response.json()).toMatchObject({
      openapi: "3.1.0",
      info: { title: "ProxyPilot API", version: "0.1.0" },
      paths: {
        "/api/v1/providers": { get: {}, post: {} },
        "/api/v1/pools/{id}/requests": { post: {} },
        "/api/v1/audit": { get: {} },
      },
      components: {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      },
    });
    await app.close();
  });

  it("returns 503 when postgres is unavailable", async () => {
    const app = buildApp({
      logger,
      webOrigin: "http://localhost:3000",
      nodeEnv: "test",
      checks: checks({
        postgres: async () => {
          throw new Error("password=db-secret");
        },
      }),
    });
    const response = await app.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_READY");
    expect(body.checks.postgres).toBe("down");
    expect(body.checks.redis).toBe("up");
    expect(JSON.stringify(body)).not.toContain("db-secret");
    await app.close();
  });

  it("hides internal error details in production", async () => {
    const app = buildApp({
      logger,
      webOrigin: "http://localhost:3000",
      nodeEnv: "production",
      checks: checks(),
      registerRoutes(instance) {
        instance.get("/boom", async () => {
          throw new Error("password=hunter2");
        });
      },
    });
    const response = await app.inject({ method: "GET", url: "/boom" });
    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body).toEqual({
      success: false,
      requestId: body.requestId,
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(body.stack).toBeUndefined();
    await app.close();
  });

  it("uses the error envelope for unknown routes", async () => {
    const app = buildApp({
      logger,
      webOrigin: "http://localhost:3000",
      nodeEnv: "test",
      checks: checks(),
    });
    const response = await app.inject({ method: "GET", url: "/missing" });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
    await app.close();
  });
});
