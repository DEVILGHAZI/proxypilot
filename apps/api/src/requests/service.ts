import { getPrisma } from "@proxypilot/database";
import {
  PoolStatus,
  canListAllApiKeys,
  eligibleProxies,
  inspectTargetUrl,
  rateWindowKey,
  type RequestMethod,
} from "@proxypilot/shared";
import type { RequestQueueJob } from "@proxypilot/worker/request-queue";
import type { PublicUser } from "../auth/service.js";
import { ApiError } from "../http-error.js";

export type PublicRequestJob = {
  id: string;
  domain: string;
  url: string;
  method: string;
  status: string;
  httpStatus: number | null;
  attempts: number;
  latencyMs: number | null;
  errorCode: string | null;
  proxyId: string | null;
  policyId: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type PublicAttempt = {
  id: string;
  attempt: number;
  status: string;
  httpStatus: number | null;
  latencyMs: number | null;
  errorCode: string | null;
  proxyId: string | null;
  createdAt: string;
};

type RequestRow = {
  id: string;
  domain: string;
  url: string;
  method: string;
  status: string;
  httpStatus: number | null;
  attempts: number;
  latencyMs: number | null;
  errorCode: string | null;
  proxyId: string | null;
  policyId: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

function toPublic(row: RequestRow): PublicRequestJob {
  return {
    id: row.id,
    domain: row.domain,
    url: row.url,
    method: row.method,
    status: row.status,
    httpStatus: row.httpStatus,
    attempts: row.attempts,
    latencyMs: row.latencyMs,
    errorCode: row.errorCode,
    proxyId: row.proxyId,
    policyId: row.policyId,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

export async function listRequests(actor: PublicUser, limit: number): Promise<PublicRequestJob[]> {
  const rows = await getPrisma().requestJob.findMany({
    where: {
      organizationId: actor.organization.id,
      ...(canListAllApiKeys(actor.role) ? {} : { userId: actor.id }),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(toPublic);
}

export async function getRequest(
  actor: PublicUser,
  requestId: string,
): Promise<{ request: PublicRequestJob; attemptLog: PublicAttempt[] }> {
  const row = await getPrisma().requestJob.findFirst({
    where: {
      id: requestId,
      organizationId: actor.organization.id,
      ...(canListAllApiKeys(actor.role) ? {} : { userId: actor.id }),
    },
    include: { attemptRows: { orderBy: { attempt: "asc" } } },
  });
  if (!row) {
    throw new ApiError(404, "NOT_FOUND", "Request not found.");
  }
  return {
    request: toPublic(row),
    attemptLog: row.attemptRows.map((attempt) => ({
      id: attempt.id,
      attempt: attempt.attempt,
      status: attempt.status,
      httpStatus: attempt.httpStatus,
      latencyMs: attempt.latencyMs,
      errorCode: attempt.errorCode,
      proxyId: attempt.proxyId,
      createdAt: attempt.createdAt.toISOString(),
    })),
  };
}

export async function submitPoolRequest(
  actor: PublicUser,
  poolId: string,
  input: { url: string; method: RequestMethod; body: string | null },
  deps: {
    enqueue?: (job: RequestQueueJob) => Promise<unknown>;
    takeSlot?: (key: string, limit: number) => Promise<boolean>;
    limits: { org: number; user: number; apiKey: number; domain: number };
    allowHosts?: ReadonlySet<string>;
    apiKeyId: string | null;
  },
): Promise<PublicRequestJob> {
  if (!deps.enqueue || !deps.takeSlot) {
    throw new ApiError(503, "REQUESTS_UNAVAILABLE", "Request execution is not configured.");
  }
  const inspected = inspectTargetUrl(input.url, deps.allowHosts);
  if (!inspected.ok) {
    throw new ApiError(400, "TARGET_BLOCKED", "The target URL must be a public http or https address.");
  }
  const pool = await getPrisma().pool.findFirst({
    where: { id: poolId, organizationId: actor.organization.id },
    include: {
      policy: true,
      poolProxies: {
        include: {
          proxy: {
            select: { id: true, status: true, healthScore: true, avgLatencyMs: true, cooldownUntil: true },
          },
        },
      },
    },
  });
  if (!pool) {
    throw new ApiError(404, "NOT_FOUND", "Pool not found.");
  }
  if (pool.status === PoolStatus.DISABLED) {
    throw new ApiError(409, "POOL_DISABLED", "This pool is disabled.");
  }
  const policy = pool.policy && pool.policy.enabled ? pool.policy : null;
  if (!policy) {
    throw new ApiError(409, "POLICY_REQUIRED", "Sending a request needs an enabled policy on the pool.");
  }
  if (eligibleProxies(pool.poolProxies.map((entry) => entry.proxy), new Date()).length === 0) {
    throw new ApiError(409, "NO_ELIGIBLE_PROXY", "No eligible proxy is available in this pool.");
  }

  const domain = inspected.url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const slots: Array<[string, number]> = [
    [rateWindowKey("org", actor.organization.id), deps.limits.org],
    [rateWindowKey("user", actor.id), deps.limits.user],
    [rateWindowKey("domain", `${actor.organization.id}:${domain}`), deps.limits.domain],
    [rateWindowKey("policy", policy.id), policy.requestsPerSecond],
  ];
  if (deps.apiKeyId) {
    slots.splice(2, 0, [rateWindowKey("key", deps.apiKeyId), deps.limits.apiKey]);
  }
  try {
    for (const [key, limit] of slots) {
      const allowed = await deps.takeSlot(key, limit);
      if (!allowed) {
        throw new ApiError(429, "RATE_LIMITED", "Request rate limit exceeded.");
      }
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(503, "RATE_LIMIT_UNAVAILABLE", "Request limits are unavailable.");
  }

  const active = await getPrisma().requestJob.count({
    where: { policyId: policy.id, status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (active >= policy.maxConcurrency) {
    throw new ApiError(429, "CONCURRENCY_LIMIT", "This policy is at its concurrency limit.");
  }

  const created = await getPrisma().requestJob.create({
    data: {
      organizationId: actor.organization.id,
      userId: actor.id,
      apiKeyId: deps.apiKeyId,
      policyId: policy.id,
      domain,
      url: input.url,
      method: input.method,
      status: "QUEUED",
    },
  });
  try {
    await deps.enqueue({ requestId: created.id, poolId: pool.id, body: input.body });
  } catch {
    await getPrisma().requestJob.update({
      where: { id: created.id },
      data: { status: "FAILED", errorCode: "QUEUE_FAILED", completedAt: new Date() },
    });
    throw new ApiError(503, "REQUESTS_UNAVAILABLE", "Request execution is not configured.");
  }
  return toPublic(created);
}
