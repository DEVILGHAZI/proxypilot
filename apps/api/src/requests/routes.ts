import {
  MAX_REQUEST_BODY_CHARS,
  REQUEST_METHODS,
  REQUEST_URL_MAX_LENGTH,
  apiSuccess,
} from "@proxypilot/shared";
import type { RequestQueueJob } from "@proxypilot/worker/request-queue";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthContext } from "../auth/service.js";
import { getRequest, listRequests, submitPoolRequest } from "./service.js";

const submitSchema = z.object({
  url: z.string().trim().min(1).max(REQUEST_URL_MAX_LENGTH),
  method: z.enum(REQUEST_METHODS).default("GET"),
  body: z.string().max(MAX_REQUEST_BODY_CHARS).nullable().optional(),
});

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type RequestRouteDeps = {
  authorize: (request: FastifyRequest) => Promise<AuthContext>;
  enqueue?: (job: RequestQueueJob) => Promise<unknown>;
  takeSlot?: (key: string, limit: number) => Promise<boolean>;
  limits: { org: number; user: number; apiKey: number; domain: number };
  allowHosts?: ReadonlySet<string>;
};

export function registerRequestRoutes(app: FastifyInstance, deps: RequestRouteDeps): void {
  app.get("/api/v1/requests", async (request) => {
    const auth = await deps.authorize(request);
    const query = listSchema.parse(request.query);
    return apiSuccess(request.id, { requests: await listRequests(auth.user, query.limit) });
  });

  app.get("/api/v1/requests/:id", async (request) => {
    const auth = await deps.authorize(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return apiSuccess(request.id, await getRequest(auth.user, params.id));
  });

  app.post("/api/v1/pools/:id/requests", async (request, reply) => {
    const auth = await deps.authorize(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = submitSchema.parse(request.body);
    const method = body.method;
    const payload = method === "GET" || method === "HEAD" ? null : (body.body ?? null);
    const created = await submitPoolRequest(
      auth.user,
      params.id,
      { url: body.url, method, body: payload },
      {
        enqueue: deps.enqueue,
        takeSlot: deps.takeSlot,
        limits: deps.limits,
        allowHosts: deps.allowHosts,
        apiKeyId: auth.apiKeyId,
      },
    );
    return reply.status(202).send(apiSuccess(request.id, { request: created }));
  });
}
