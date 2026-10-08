import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import { apiFailure } from "@proxypilot/shared";
import { redactSecrets } from "@proxypilot/logger";
import Fastify, { type FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { ZodError } from "zod";
import { registerAuthRoutes, type AuthRouteOptions } from "./auth/routes.js";
import { ApiError } from "./http-error.js";
import { openApiDocument } from "./openapi.js";

const REQUEST_ID_PATTERN = /^req_[A-Za-z0-9-]{8,80}$/;

export type DependencyState = "up" | "down" | "unknown";

export type DependencyChecks = {
  postgres: () => Promise<void>;
  redis: () => Promise<void>;
  workerHeartbeat: () => Promise<string | null>;
};

export type BuildAppOptions = {
  logger: Logger;
  webOrigin: string;
  nodeEnv: "development" | "test" | "production";
  checks: DependencyChecks;
  auth?: AuthRouteOptions;
  registerRoutes?: (app: FastifyInstance) => void;
};

export function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    logger: false,
    genReqId(request) {
      const header = request.headers["x-request-id"];
      if (typeof header === "string" && REQUEST_ID_PATTERN.test(header)) {
        return header;
      }
      return `req_${randomUUID()}`;
    },
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  void app.register(cors, {
    origin: options.webOrigin,
    credentials: true,
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send(apiFailure(request.id, "NOT_FOUND", "Route not found."));
  });

  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof Error ? error : new Error("Unexpected error");
    const statusFromError =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send(apiFailure(request.id, error.code, error.message));
    }
    if (error instanceof ZodError) {
      const message = error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
      return reply.status(400).send(apiFailure(request.id, "VALIDATION_ERROR", message));
    }
    const statusCode = statusFromError && statusFromError >= 400 ? statusFromError : 500;
    const isServer = statusCode >= 500;
    const code = isServer ? "INTERNAL_ERROR" : "BAD_REQUEST";
    const message =
      isServer && options.nodeEnv === "production" ? "An unexpected error occurred." : known.message;
    options.logger.error(
      redactSecrets({
        requestId: request.id,
        statusCode,
        err: error,
      }),
      "request failed",
    );
    return reply.status(statusCode).send(apiFailure(request.id, code, message));
  });

  app.get("/health", async (request) => {
    return {
      success: true as const,
      requestId: request.id,
      data: {
        status: "ok" as const,
        service: "proxypilot-api",
      },
    };
  });

  app.get("/ready", async (request, reply) => {
    const checks: { postgres: DependencyState; redis: DependencyState; worker: DependencyState } = {
      postgres: "down",
      redis: "down",
      worker: "unknown",
    };

    try {
      await options.checks.postgres();
      checks.postgres = "up";
    } catch (error) {
      options.logger.warn(redactSecrets({ requestId: request.id, err: error }), "postgres check failed");
    }

    try {
      await options.checks.redis();
      checks.redis = "up";
    } catch (error) {
      options.logger.warn(redactSecrets({ requestId: request.id, err: error }), "redis check failed");
    }

    try {
      const heartbeat = await options.checks.workerHeartbeat();
      checks.worker = heartbeat ? "up" : "unknown";
    } catch (error) {
      options.logger.warn(redactSecrets({ requestId: request.id, err: error }), "worker heartbeat unreadable");
      checks.worker = "unknown";
    }

    if (checks.postgres !== "up" || checks.redis !== "up") {
      return reply.status(503).send({
        ...apiFailure(request.id, "NOT_READY", "One or more dependencies are unavailable."),
        checks,
      });
    }

    return {
      success: true as const,
      requestId: request.id,
      data: {
        status: "ready" as const,
        checks,
      },
    };
  });

  app.get("/api/v1", async (request) => {
    return {
      success: true as const,
      requestId: request.id,
      data: {
        name: "proxypilot",
        version: "0.1.0",
        apiVersion: "v1",
      },
    };
  });

  app.get("/openapi.json", async (_request, reply) => {
    return reply.header("cache-control", "public, max-age=300").send(openApiDocument);
  });

  if (options.auth) {
    registerAuthRoutes(app, options.auth);
  }

  options.registerRoutes?.(app);

  app.addHook("onResponse", async (request, reply) => {
    options.logger.info(
      {
        requestId: request.id,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTimeMs: Math.round(reply.elapsedTime),
      },
      "request completed",
    );
  });

  return app;
}
