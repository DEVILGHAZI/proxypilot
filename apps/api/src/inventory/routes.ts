import { apiSuccess, type HealthThresholds } from "@proxypilot/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z, type ZodError } from "zod";
import type { AuthContext } from "../auth/service.js";
import { ApiError } from "../http-error.js";
import {
  createPool,
  createProvider,
  createProxy,
  deleteProvider,
  deleteProxy,
  deleteTag,
  importProxies,
  listPools,
  listProviders,
  listProxies,
  listTags,
  setPoolProxies,
  setProxyEnabled,
  updateProvider,
  updateProxy,
} from "./service.js";

const protocolSchema = z.enum(["HTTP", "HTTPS", "SOCKS5"]);
const providerTypeSchema = z.enum(["DATACENTER", "RESIDENTIAL", "ISP", "MOBILE", "CUSTOM"]);
const providerStatusSchema = z.enum(["ACTIVE", "DISABLED"]);
const proxyStatusSchema = z.enum(["HEALTHY", "DEGRADED", "QUARANTINED", "DISABLED"]);
const strategySchema = z.enum(["RANDOM", "ROUND_ROBIN", "LEAST_LATENCY", "WEIGHTED_HEALTH", "STICKY_SESSION"]);
const metadataSchema = z.record(z.union([z.string().max(200), z.number(), z.boolean()])).refine((value) => Object.keys(value).length <= 20, {
  message: "metadata accepts at most 20 keys",
});
const hostSchema = z.string().trim().min(1).max(253);
const tagNamesSchema = z.array(z.string().trim().min(1).max(40)).max(20);

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

const providerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: providerTypeSchema,
  protocol: protocolSchema,
  metadata: metadataSchema.optional(),
  username: z.string().max(256).nullable().optional(),
  password: z.string().max(256).nullable().optional(),
});

const providerPatchSchema = providerSchema
  .partial()
  .extend({ status: providerStatusSchema.optional() })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Provide a field to update.",
  });

const proxySchema = z.object({
  providerId: z.string().min(1),
  host: hostSchema,
  port: z.number().int().min(1).max(65535),
  protocol: protocolSchema.optional(),
  username: z.string().max(256).nullable().optional(),
  password: z.string().max(256).nullable().optional(),
  country: z.string().trim().max(80).nullable().optional(),
  region: z.string().trim().max(80).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  tagNames: tagNamesSchema.optional(),
});

const proxyPatchSchema = proxySchema
  .omit({ providerId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Provide a field to update." });

const importSchema = z.object({
  providerId: z.string().min(1),
  text: z.string().min(1).max(200_000),
  protocol: protocolSchema.optional(),
});

const poolSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).nullable().optional(),
  strategy: strategySchema.default("ROUND_ROBIN"),
  policyId: z.string().min(1).nullable().optional(),
});

const poolMembersSchema = z.object({
  proxyIds: z.array(z.string().min(1)).max(500),
});

const listQuerySchema = z.object({
  providerId: z.string().min(1).optional(),
  status: proxyStatusSchema.optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  poolId: z.string().min(1).optional(),
});

export type InventoryRouteDeps = {
  encryptionKey: Buffer;
  authorize: (request: FastifyRequest) => Promise<AuthContext>;
  meta: (request: FastifyRequest) => { ip: string | null; userAgent: string | null };
  health: {
    cooldownSeconds: number;
    thresholds: HealthThresholds;
    enqueueRecovery?: (proxyId: string, delayMs: number) => Promise<void>;
  };
};

export function registerInventoryRoutes(app: FastifyInstance, deps: InventoryRouteDeps): void {
  app.get("/api/v1/providers", async (request) => {
    const auth = await deps.authorize(request);
    return apiSuccess(request.id, { providers: await listProviders(auth.user) });
  });

  app.post("/api/v1/providers", async (request, reply) => {
    const auth = await deps.authorize(request);
    const body = parseBody(providerSchema, request.body);
    const provider = await createProvider(auth.user, deps.encryptionKey, { ...body, metadata: body.metadata ?? {} }, deps.meta(request));
    return reply.status(201).send(apiSuccess(request.id, { provider }));
  });

  app.patch("/api/v1/providers/:id", async (request) => {
    const auth = await deps.authorize(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = parseBody(providerPatchSchema, request.body);
    const provider = await updateProvider(auth.user, deps.encryptionKey, params.id, body, deps.meta(request));
    return apiSuccess(request.id, { provider });
  });

  app.delete("/api/v1/providers/:id", async (request) => {
    const auth = await deps.authorize(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    await deleteProvider(auth.user, params.id, deps.meta(request));
    return apiSuccess(request.id, { deleted: true as const });
  });

  app.get("/api/v1/proxies", async (request) => {
    const auth = await deps.authorize(request);
    const query = parseBody(listQuerySchema, request.query);
    return apiSuccess(request.id, { proxies: await listProxies(auth.user, query) });
  });

  app.post("/api/v1/proxies", async (request, reply) => {
    const auth = await deps.authorize(request);
    const body = parseBody(proxySchema, request.body);
    const proxy = await createProxy(auth.user, deps.encryptionKey, body, deps.meta(request));
    return reply.status(201).send(apiSuccess(request.id, { proxy }));
  });

  app.patch("/api/v1/proxies/:id", async (request) => {
    const auth = await deps.authorize(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = parseBody(proxyPatchSchema, request.body);
    const proxy = await updateProxy(auth.user, deps.encryptionKey, params.id, body, deps.meta(request));
    return apiSuccess(request.id, { proxy });
  });

  app.post("/api/v1/proxies/:id/disable", async (request) => {
    const auth = await deps.authorize(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const proxy = await setProxyEnabled(auth.user, params.id, false, deps.meta(request), deps.health);
    return apiSuccess(request.id, { proxy });
  });

  app.post("/api/v1/proxies/:id/enable", async (request) => {
    const auth = await deps.authorize(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const proxy = await setProxyEnabled(auth.user, params.id, true, deps.meta(request), deps.health);
    if (proxy.status === "QUARANTINED") {
      await deps.health.enqueueRecovery?.(proxy.id, deps.health.cooldownSeconds * 1000);
    }
    return apiSuccess(request.id, { proxy });
  });

  app.delete("/api/v1/proxies/:id", async (request) => {
    const auth = await deps.authorize(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    await deleteProxy(auth.user, params.id, deps.meta(request));
    return apiSuccess(request.id, { deleted: true as const });
  });

  app.post("/api/v1/proxies/import", async (request, reply) => {
    const auth = await deps.authorize(request);
    const body = parseBody(importSchema, request.body);
    const result = await importProxies(auth.user, deps.encryptionKey, body, deps.meta(request));
    return reply.status(201).send(apiSuccess(request.id, result));
  });

  app.get("/api/v1/tags", async (request) => {
    const auth = await deps.authorize(request);
    return apiSuccess(request.id, { tags: await listTags(auth.user) });
  });

  app.delete("/api/v1/tags/:id", async (request) => {
    const auth = await deps.authorize(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    await deleteTag(auth.user, params.id, deps.meta(request));
    return apiSuccess(request.id, { deleted: true as const });
  });

  app.get("/api/v1/pools", async (request) => {
    const auth = await deps.authorize(request);
    return apiSuccess(request.id, { pools: await listPools(auth.user) });
  });

  app.post("/api/v1/pools", async (request, reply) => {
    const auth = await deps.authorize(request);
    const body = parseBody(poolSchema, request.body);
    const pool = await createPool(
      auth.user,
      { ...body, strategy: body.strategy ?? "ROUND_ROBIN" },
      deps.meta(request),
    );
    return reply.status(201).send(apiSuccess(request.id, { pool }));
  });

  app.put("/api/v1/pools/:id/proxies", async (request) => {
    const auth = await deps.authorize(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = parseBody(poolMembersSchema, request.body);
    const pool = await setPoolProxies(auth.user, params.id, body.proxyIds, deps.meta(request));
    return apiSuccess(request.id, { pool });
  });
}
