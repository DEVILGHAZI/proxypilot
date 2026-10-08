import {
  DEFAULT_COOLDOWN_SECONDS,
  DEFAULT_HEALTH_THRESHOLDS,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  apiSuccess,
  type HealthThresholds,
} from "@proxypilot/shared";
import type { UserRole as UserRoleName, UserStatus as UserStatusName } from "@proxypilot/shared";
import type { RequestQueueJob } from "@proxypilot/worker/request-queue";
import type { SiteCheckQueueJob } from "@proxypilot/worker/site-check-queue";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, type ZodError } from "zod";
import { ApiError } from "../http-error.js";
import { registerAnalyticsRoutes } from "../analytics/routes.js";
import { registerAuditRoutes } from "../audit/routes.js";
import { registerHealthRoutes } from "../health/routes.js";
import { registerInventoryRoutes } from "../inventory/routes.js";
import { registerRequestRoutes } from "../requests/routes.js";
import { registerSiteCheckRoutes } from "../site-check/routes.js";
import { registerRotationRoutes } from "../rotation/routes.js";
import type { LoginCounter } from "./throttle.js";
import {
  authenticate,
  createApiKey,
  createOrgUser,
  listApiKeys,
  listOrgUsers,
  loginAccount,
  logoutSession,
  registerAccount,
  revokeApiKey,
  updateOrgUser,
  type AuthContext,
} from "./service.js";

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

const passwordSchema = z.string().min(12).max(128);
const roleSchema = z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
const statusSchema = z.enum(["ACTIVE", "SUSPENDED", "DISABLED"]);

const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    name: z.string().trim().min(1).max(80),
    organizationName: z.string().trim().min(2).max(80),
  })
  .refine((value) => value.password.toLowerCase() !== value.email, {
    path: ["password"],
    message: "Password must not match the email.",
  });

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

const createUserSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    name: z.string().trim().min(1).max(80),
    role: roleSchema,
  })
  .refine((value) => value.password.toLowerCase() !== value.email, {
    path: ["password"],
    message: "Password must not match the email.",
  });

const updateUserSchema = z
  .object({
    role: roleSchema.optional(),
    status: statusSchema.optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: "Provide a role or a status.",
  });

const createKeySchema = z.object({
  name: z.string().trim().min(1).max(64),
  expiresAt: z.string().datetime().optional(),
});

export type AuthRouteOptions = {
  sessionSecret: string;
  nodeEnv: "development" | "test" | "production";
  counter: LoginCounter;
  encryptionKey: Buffer;
  health?: {
    enqueueCheck?: (proxyId: string) => Promise<"queued" | "already">;
    enqueueRecovery?: (proxyId: string, delayMs: number) => Promise<void>;
    cooldownSeconds: number;
    thresholds: HealthThresholds;
  };
  nextCursor?: (organizationId: string, poolId: string) => Promise<number>;
  requests?: {
    enqueue?: (job: RequestQueueJob) => Promise<unknown>;
    takeSlot?: (key: string, limit: number) => Promise<boolean>;
    limits: { org: number; user: number; apiKey: number; domain: number };
    allowHosts?: ReadonlySet<string>;
  };
  siteChecks?: {
    enqueue?: (job: SiteCheckQueueJob) => Promise<unknown>;
    allowHosts?: ReadonlySet<string>;
  };
};

function validationError(error: ZodError): ApiError {
  const message = error.issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
  return new ApiError(400, "VALIDATION_ERROR", message);
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw validationError(result.error);
  }
  return result.data;
}

function requestMeta(request: FastifyRequest): { ip: string | null; userAgent: string | null } {
  const agent = request.headers["user-agent"];
  return {
    ip: request.ip || null,
    userAgent: typeof agent === "string" ? agent.slice(0, 256) : null,
  };
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string") {
    return null;
  }
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }
  return token;
}

function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  reply.header("set-cookie", parts.join("; "));
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.header("set-cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

async function requireAuth(request: FastifyRequest, options: AuthRouteOptions): Promise<AuthContext> {
  const auth = await authenticate({
    sessionSecret: options.sessionSecret,
    sessionToken: readCookie(request.headers.cookie, SESSION_COOKIE),
    bearer: bearerToken(request),
  });
  if (!auth) {
    throw new ApiError(401, "UNAUTHENTICATED", "Sign in required.");
  }
  return auth;
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const secure = options.nodeEnv === "production";

  app.post("/api/v1/auth/register", async (request, reply) => {
    const body = parse(registerSchema, request.body);
    const result = await registerAccount(options.sessionSecret, { ...body, meta: requestMeta(request) });
    setSessionCookie(reply, result.sessionToken, secure);
    return reply.status(201).send(apiSuccess(request.id, { user: result.user }));
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    const body = parse(loginSchema, request.body);
    const result = await loginAccount(options.counter, options.sessionSecret, {
      ...body,
      meta: requestMeta(request),
    });
    setSessionCookie(reply, result.sessionToken, secure);
    return apiSuccess(request.id, { user: result.user });
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token) {
      throw new ApiError(401, "UNAUTHENTICATED", "Sign in required.");
    }
    await logoutSession(options.sessionSecret, token, requestMeta(request));
    clearSessionCookie(reply);
    return apiSuccess(request.id, { status: "logged_out" as const });
  });

  app.get("/api/v1/auth/me", async (request) => {
    const auth = await requireAuth(request, options);
    return apiSuccess(request.id, { user: auth.user, apiKeyId: auth.apiKeyId });
  });

  app.get("/api/v1/users", async (request) => {
    const auth = await requireAuth(request, options);
    return apiSuccess(request.id, { users: await listOrgUsers(auth.user) });
  });

  app.post("/api/v1/users", async (request, reply) => {
    const auth = await requireAuth(request, options);
    const body = parse(createUserSchema, request.body);
    const user = await createOrgUser(
      auth.user,
      { ...body, role: body.role as UserRoleName },
      requestMeta(request),
    );
    return reply.status(201).send(apiSuccess(request.id, { user }));
  });

  app.patch("/api/v1/users/:id", async (request) => {
    const auth = await requireAuth(request, options);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = parse(updateUserSchema, request.body);
    const user = await updateOrgUser(
      auth.user,
      params.id,
      {
        role: body.role as UserRoleName | undefined,
        status: body.status as UserStatusName | undefined,
      },
      requestMeta(request),
    );
    return apiSuccess(request.id, { user });
  });

  app.get("/api/v1/api-keys", async (request) => {
    const auth = await requireAuth(request, options);
    return apiSuccess(request.id, { apiKeys: await listApiKeys(auth.user) });
  });

  app.post("/api/v1/api-keys", async (request, reply) => {
    const auth = await requireAuth(request, options);
    const body = parse(createKeySchema, request.body);
    const created = await createApiKey(
      auth.user,
      {
        name: body.name,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
      requestMeta(request),
    );
    return reply.status(201).send(apiSuccess(request.id, created));
  });

  app.post("/api/v1/api-keys/:id/revoke", async (request) => {
    const auth = await requireAuth(request, options);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const apiKey = await revokeApiKey(auth.user, params.id, requestMeta(request));
    return apiSuccess(request.id, { apiKey });
  });

  const health = {
    cooldownSeconds: options.health?.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS,
    thresholds: options.health?.thresholds ?? DEFAULT_HEALTH_THRESHOLDS,
    enqueueCheck: options.health?.enqueueCheck,
    enqueueRecovery: options.health?.enqueueRecovery,
  };

  registerInventoryRoutes(app, {
    encryptionKey: options.encryptionKey,
    authorize: (request) => requireAuth(request, options),
    meta: requestMeta,
    health,
  });
  registerHealthRoutes(app, {
    authorize: (request) => requireAuth(request, options),
    enqueueCheck: health.enqueueCheck,
  });
  registerRotationRoutes(app, {
    authorize: (request) => requireAuth(request, options),
    meta: requestMeta,
    nextCursor: options.nextCursor,
  });
  registerRequestRoutes(app, {
    authorize: (request) => requireAuth(request, options),
    enqueue: options.requests?.enqueue,
    takeSlot: options.requests?.takeSlot,
    limits: options.requests?.limits ?? { org: 100, user: 30, apiKey: 30, domain: 20 },
    allowHosts: options.requests?.allowHosts,
  });
  registerAnalyticsRoutes(app, {
    authorize: (request) => requireAuth(request, options),
  });
  registerAuditRoutes(app, {
    authorize: (request) => requireAuth(request, options),
  });
  registerSiteCheckRoutes(app, {
    authorize: (request) => requireAuth(request, options),
    enqueue: options.siteChecks?.enqueue,
    allowHosts: options.siteChecks?.allowHosts,
  });
}
