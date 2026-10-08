import { apiSuccess } from "@proxypilot/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthContext } from "../auth/service.js";
import { listHealthChecks, requestHealthCheck } from "./service.js";

const querySchema = z.object({
  proxyId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type HealthRouteDeps = {
  authorize: (request: FastifyRequest) => Promise<AuthContext>;
  enqueueCheck?: (proxyId: string) => Promise<"queued" | "already">;
};

export function registerHealthRoutes(app: FastifyInstance, deps: HealthRouteDeps): void {
  app.get("/api/v1/health", async (request) => {
    const auth = await deps.authorize(request);
    const query = querySchema.parse(request.query);
    const checks = await listHealthChecks(auth.user, { proxyId: query.proxyId, limit: query.limit });
    return apiSuccess(request.id, { checks });
  });

  app.post("/api/v1/proxies/:id/check", async (request, reply) => {
    const auth = await deps.authorize(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const result = await requestHealthCheck(auth.user, params.id, deps.enqueueCheck);
    return reply.status(202).send(apiSuccess(request.id, result));
  });
}
