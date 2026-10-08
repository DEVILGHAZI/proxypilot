import { apiSuccess } from "@proxypilot/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthContext } from "../auth/service.js";
import { listAuditEvents } from "./service.js";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type AuditRouteDeps = {
  authorize: (request: FastifyRequest) => Promise<AuthContext>;
};

export function registerAuditRoutes(app: FastifyInstance, deps: AuditRouteDeps): void {
  app.get("/api/v1/audit", async (request) => {
    const auth = await deps.authorize(request);
    const query = querySchema.parse(request.query);
    return apiSuccess(request.id, { events: await listAuditEvents(auth.user, query.limit) });
  });
}
