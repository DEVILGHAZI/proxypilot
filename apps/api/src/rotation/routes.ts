import { apiSuccess } from "@proxypilot/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z, type ZodError } from "zod";
import type { AuthContext } from "../auth/service.js";
import { ApiError } from "../http-error.js";
import {
  createPolicy,
  deletePolicy,
  listPolicies,
  listProxySessions,
  releaseProxySession,
  selectPoolProxy,
  updatePolicy,
} from "./service.js";

const strategySchema = z.enum(["RANDOM", "ROUND_ROBIN", "LEAST_LATENCY", "WEIGHTED_HEALTH", "STICKY_SESSION"]);

const policySchema = z.object({
  name: z.string().trim().min(1).max(80),
  strategy: strategySchema,
  timeoutMs: z.number().int().min(100).max(300_000),
  maxRetries: z.number().int().min(0).max(10),
  cooldownSeconds: z.number().int().min(0).max(86_400),
  sessionTtlSeconds: z.number().int().min(30).max(604_800),
  maxConcurrency: z.number().int().min(1).max(1_000),
  requestsPerSecond: z.number().int().min(1).max(10_000),
  enabled: z.boolean().optional(),
});

const policyPatchSchema = policySchema.partial().refine((value) => Object.values(value).some((entry) => entry !== undefined), {
  message: "Provide a field to update.",
});

function validationError(error: ZodError): ApiError {
  const message = error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
  return new ApiError(400, "VALIDATION_ERROR", message);
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw validationError(result.error);
  }
  return result.data;
}

export type RotationRouteDeps = {
  authorize: (request: FastifyRequest) => Promise<AuthContext>;
  meta: (request: FastifyRequest) => { ip: string | null; userAgent: string | null };
  nextCursor?: (organizationId: string, poolId: string) => Promise<number>;
};

export function registerRotationRoutes(app: FastifyInstance, deps: RotationRouteDeps): void {
  app.get("/api/v1/policies", async (request) => {
    const auth = await deps.authorize(request);
    return apiSuccess(request.id, { policies: await listPolicies(auth.user) });
  });

  app.post("/api/v1/policies", async (request, reply) => {
    const auth = await deps.authorize(request);
    const body = parseBody(policySchema, request.body);
    const policy = await createPolicy(auth.user, body, deps.meta(request));
    return reply.status(201).send(apiSuccess(request.id, { policy }));
  });

  app.patch("/api/v1/policies/:id", async (request) => {
    const auth = await deps.authorize(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = parseBody(policyPatchSchema, request.body);
    const policy = await updatePolicy(auth.user, params.id, body, deps.meta(request));
    return apiSuccess(request.id, { policy });
  });

  app.delete("/api/v1/policies/:id", async (request) => {
    const auth = await deps.authorize(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    await deletePolicy(auth.user, params.id, deps.meta(request));
    return apiSuccess(request.id, { deleted: true as const });
  });

  app.get("/api/v1/sessions", async (request) => {
    const auth = await deps.authorize(request);
    return apiSuccess(request.id, { sessions: await listProxySessions(auth.user) });
  });

  app.delete("/api/v1/sessions/:id", async (request) => {
    const auth = await deps.authorize(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    await releaseProxySession(auth.user, params.id);
    return apiSuccess(request.id, { deleted: true as const });
  });

  app.post("/api/v1/pools/:id/select", async (request) => {
    const auth = await deps.authorize(request);
    if (!deps.nextCursor) {
      throw new ApiError(503, "ROTATION_UNAVAILABLE", "Rotation is not configured.");
    }
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const selection = await selectPoolProxy(auth.user, params.id, deps.nextCursor);
    return apiSuccess(request.id, { selection });
  });
}
