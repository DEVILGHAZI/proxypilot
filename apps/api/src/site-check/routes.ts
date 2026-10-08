import { SITE_CHECK_BROWSERS, apiSuccess } from "@proxypilot/shared";
import type { SiteCheckQueueJob } from "@proxypilot/worker/site-check-queue";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthContext } from "../auth/service.js";
import { createSiteCheck, getSiteCheck, listSiteChecks } from "./service.js";

const createSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  browser: z.enum(SITE_CHECK_BROWSERS).default("CHROME"),
});

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export type SiteCheckRouteDeps = {
  authorize: (request: FastifyRequest) => Promise<AuthContext>;
  enqueue?: (job: SiteCheckQueueJob) => Promise<unknown>;
  allowHosts?: ReadonlySet<string>;
};

export function registerSiteCheckRoutes(app: FastifyInstance, deps: SiteCheckRouteDeps): void {
  app.get("/api/v1/site-checks", async (request) => {
    const auth = await deps.authorize(request);
    const query = listSchema.parse(request.query);
    return apiSuccess(request.id, { runs: await listSiteChecks(auth.user, query.limit) });
  });

  app.get("/api/v1/site-checks/:id", async (request) => {
    const auth = await deps.authorize(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return apiSuccess(request.id, { run: await getSiteCheck(auth.user, params.id) });
  });

  app.post("/api/v1/pools/:id/site-checks", async (request, reply) => {
    const auth = await deps.authorize(request);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = createSchema.parse(request.body);
    const run = await createSiteCheck(auth.user, params.id, { url: body.url, browser: body.browser }, deps);
    return reply.status(202).send(apiSuccess(request.id, { run }));
  });
}
