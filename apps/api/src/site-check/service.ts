import { getPrisma } from "@proxypilot/database";
import {
  SITE_CHECK_MAX_PROXIES,
  canListAllApiKeys,
  inspectTargetUrl,
  siteCheckLayout,
  siteCheckSummary,
  type SiteCheckBrowserName,
} from "@proxypilot/shared";
import type { SiteCheckQueueJob } from "@proxypilot/worker/site-check-queue";
import type { PublicUser } from "../auth/service.js";
import { ApiError } from "../http-error.js";

export type PublicSiteCheck = {
  id: string;
  proxyId: string;
  host: string;
  port: number;
  country: string | null;
  layout: string;
  status: string;
  title: string | null;
  scrolled: boolean;
  latencyMs: number | null;
  errorCode: string | null;
};

export type PublicSiteCheckRun = {
  id: string;
  poolId: string;
  url: string;
  browser: string;
  status: string;
  total: number;
  passed: number;
  failed: number;
  summary: string;
  createdAt: string;
  completedAt: string | null;
  checks: PublicSiteCheck[];
};

type RunRecord = {
  id: string;
  poolId: string;
  url: string;
  browser: string;
  status: string;
  total: number;
  passed: number;
  failed: number;
  createdAt: Date;
  completedAt: Date | null;
  checks: Array<{
    id: string;
    proxyId: string;
    layout: string;
    status: string;
    title: string | null;
    scrolled: boolean;
    latencyMs: number | null;
    errorCode: string | null;
    proxy: { host: string; port: number; country: string | null };
  }>;
};

function presentRun(run: RunRecord): PublicSiteCheckRun {
  const finished = run.status === "PASSED" || run.status === "FAILED";
  return {
    id: run.id,
    poolId: run.poolId,
    url: run.url,
    browser: run.browser,
    status: run.status,
    total: run.total,
    passed: run.passed,
    failed: run.failed,
    summary: finished ? siteCheckSummary(run.passed, run.total) : "Site check is still running.",
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    checks: run.checks.map((check) => ({
      id: check.id,
      proxyId: check.proxyId,
      host: check.proxy.host,
      port: check.proxy.port,
      country: check.proxy.country,
      layout: check.layout,
      status: check.status,
      title: check.title,
      scrolled: check.scrolled,
      latencyMs: check.latencyMs,
      errorCode: check.errorCode,
    })),
  };
}

const runInclude = {
  checks: {
    include: { proxy: { select: { host: true, port: true, country: true } } },
    orderBy: { createdAt: "asc" as const },
  },
};

export async function createSiteCheck(
  actor: PublicUser,
  poolId: string,
  input: { url: string; browser: SiteCheckBrowserName },
  deps: { enqueue?: (job: SiteCheckQueueJob) => Promise<unknown>; allowHosts?: ReadonlySet<string> },
): Promise<PublicSiteCheckRun> {
  if (!deps.enqueue) {
    throw new ApiError(503, "SITE_CHECKS_UNAVAILABLE", "Site checks are not configured.");
  }
  const inspected = inspectTargetUrl(input.url, deps.allowHosts);
  if (!inspected.ok) {
    throw new ApiError(400, "TARGET_BLOCKED", "The target URL must be a public http or https address.");
  }
  const pool = await getPrisma().pool.findFirst({
    where: { id: poolId, organizationId: actor.organization.id },
    include: { poolProxies: { include: { proxy: true } } },
  });
  if (!pool) {
    throw new ApiError(404, "NOT_FOUND", "Pool not found.");
  }
  const proxies = pool.poolProxies.map((membership) => membership.proxy).filter((proxy) => proxy.status !== "DISABLED");
  if (proxies.length === 0) {
    throw new ApiError(409, "NO_ELIGIBLE_PROXY", "Add a proxy to this pool before running a site check.");
  }
  if (proxies.length > SITE_CHECK_MAX_PROXIES) {
    throw new ApiError(400, "VALIDATION_ERROR", `A site check accepts at most ${SITE_CHECK_MAX_PROXIES} proxies.`);
  }
  const run = await getPrisma().siteCheckRun.create({
    data: {
      organizationId: actor.organization.id,
      userId: actor.id,
      poolId: pool.id,
      url: inspected.url.href,
      browser: input.browser,
      total: proxies.length,
      checks: {
        create: proxies.map((proxy, index) => ({
          proxyId: proxy.id,
          layout: siteCheckLayout(input.browser, index),
        })),
      },
    },
    include: runInclude,
  });
  try {
    for (const check of run.checks) {
      await deps.enqueue({ checkId: check.id });
    }
  } catch {
    await getPrisma().siteCheckRun.update({
      where: { id: run.id },
      data: { status: "FAILED", failed: run.total, completedAt: new Date() },
    });
    throw new ApiError(503, "SITE_CHECKS_UNAVAILABLE", "Site checks are not configured.");
  }
  return presentRun(run);
}

export async function listSiteChecks(actor: PublicUser, limit: number): Promise<PublicSiteCheckRun[]> {
  const rows = await getPrisma().siteCheckRun.findMany({
    where: {
      organizationId: actor.organization.id,
      ...(canListAllApiKeys(actor.role) ? {} : { userId: actor.id }),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: runInclude,
  });
  return rows.map(presentRun);
}

export async function getSiteCheck(actor: PublicUser, runId: string): Promise<PublicSiteCheckRun> {
  const run = await getPrisma().siteCheckRun.findFirst({
    where: {
      id: runId,
      organizationId: actor.organization.id,
      ...(canListAllApiKeys(actor.role) ? {} : { userId: actor.id }),
    },
    include: runInclude,
  });
  if (!run) {
    throw new ApiError(404, "NOT_FOUND", "Site check not found.");
  }
  return presentRun(run);
}
