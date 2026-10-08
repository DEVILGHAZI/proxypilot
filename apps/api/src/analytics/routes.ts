import { apiSuccess } from "@proxypilot/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthContext } from "../auth/service.js";
import { readAnalytics } from "./service.js";

const querySchema = z.object({
  hours: z.coerce.number().int().min(1).max(168).default(24),
});

export type AnalyticsRouteDeps = {
  authorize: (request: FastifyRequest) => Promise<AuthContext>;
};

export function registerAnalyticsRoutes(app: FastifyInstance, deps: AnalyticsRouteDeps): void {
  app.get("/api/v1/analytics", async (request) => {
    const auth = await deps.authorize(request);
    const query = querySchema.parse(request.query);
    return apiSuccess(request.id, { analytics: await readAnalytics(auth.user, query.hours) });
  });
}
