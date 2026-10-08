import { getPrisma } from "@proxypilot/database";
import {
  PoolStatus,
  canDeleteInventory,
  canListAllApiKeys,
  canWriteInventory,
  pickProxy,
  type RotationCandidate,
  type RotationStrategy as RotationStrategyName,
} from "@proxypilot/shared";
import type { Prisma } from "@prisma/client";
import type { PublicUser } from "../auth/service.js";
import { ApiError } from "../http-error.js";

type RequestMeta = { ip: string | null };

export type PublicPolicy = {
  id: string;
  name: string;
  strategy: RotationStrategyName;
  timeoutMs: number;
  maxRetries: number;
  cooldownSeconds: number;
  sessionTtlSeconds: number;
  maxConcurrency: number;
  requestsPerSecond: number;
  enabled: boolean;
  poolCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PublicProxySession = {
  id: string;
  policyId: string;
  proxyId: string;
  host: string;
  port: number;
  protocol: string;
  expiresAt: string;
  lastUsedAt: string;
};

export type ProxySelection = {
  poolId: string;
  strategy: RotationStrategyName;
  proxy: {
    id: string;
    host: string;
    port: number;
    protocol: string;
    status: string;
    healthScore: number;
    avgLatencyMs: number | null;
  };
  session: { id: string; expiresAt: string } | null;
};

type PolicyInput = {
  name: string;
  strategy: RotationStrategyName;
  timeoutMs: number;
  maxRetries: number;
  cooldownSeconds: number;
  sessionTtlSeconds: number;
  maxConcurrency: number;
  requestsPerSecond: number;
  enabled?: boolean;
};

function assertWrite(actor: PublicUser): void {
  if (!canWriteInventory(actor.role)) {
    throw new ApiError(403, "FORBIDDEN", "You cannot change rotation settings.");
  }
}

function assertDelete(actor: PublicUser): void {
  if (!canDeleteInventory(actor.role)) {
    throw new ApiError(403, "FORBIDDEN", "You cannot delete rotation settings.");
  }
}

async function audit(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    userId: string;
    action: "POLICY_CREATED" | "SETTINGS_CHANGED";
    resource: string;
    resourceId?: string;
    ip: string | null;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      ip: input.ip,
      metadata: input.metadata ?? {},
    },
  });
}

function toPolicy(row: {
  id: string;
  name: string;
  strategy: RotationStrategyName;
  timeoutMs: number;
  maxRetries: number;
  cooldownSeconds: number;
  sessionTtlSeconds: number;
  maxConcurrency: number;
  requestsPerSecond: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { pools: number };
}): PublicPolicy {
  return {
    id: row.id,
    name: row.name,
    strategy: row.strategy,
    timeoutMs: row.timeoutMs,
    maxRetries: row.maxRetries,
    cooldownSeconds: row.cooldownSeconds,
    sessionTtlSeconds: row.sessionTtlSeconds,
    maxConcurrency: row.maxConcurrency,
    requestsPerSecond: row.requestsPerSecond,
    enabled: row.enabled,
    poolCount: row._count.pools,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listPolicies(actor: PublicUser): Promise<PublicPolicy[]> {
  const rows = await getPrisma().policy.findMany({
    where: { organizationId: actor.organization.id },
    include: { _count: { select: { pools: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toPolicy);
}

export async function createPolicy(actor: PublicUser, input: PolicyInput, meta: RequestMeta): Promise<PublicPolicy> {
  assertWrite(actor);
  const duplicate = await getPrisma().policy.findFirst({
    where: { organizationId: actor.organization.id, name: input.name },
    select: { id: true },
  });
  if (duplicate) {
    throw new ApiError(409, "NAME_IN_USE", "A policy with that name already exists.");
  }
  const created = await getPrisma().$transaction(async (tx) => {
    const policy = await tx.policy.create({
      data: {
        organizationId: actor.organization.id,
        name: input.name,
        strategy: input.strategy,
        timeoutMs: input.timeoutMs,
        maxRetries: input.maxRetries,
        cooldownSeconds: input.cooldownSeconds,
        sessionTtlSeconds: input.sessionTtlSeconds,
        maxConcurrency: input.maxConcurrency,
        requestsPerSecond: input.requestsPerSecond,
        enabled: input.enabled ?? true,
      },
      include: { _count: { select: { pools: true } } },
    });
    await audit(tx, {
      organizationId: actor.organization.id,
      userId: actor.id,
      action: "POLICY_CREATED",
      resource: "policy",
      resourceId: policy.id,
      ip: meta.ip,
      metadata: { name: policy.name, strategy: policy.strategy, maxRetries: policy.maxRetries },
    });
    return policy;
  });
  return toPolicy(created);
}

export async function updatePolicy(
  actor: PublicUser,
  policyId: string,
  input: Partial<PolicyInput>,
  meta: RequestMeta,
): Promise<PublicPolicy> {
  assertWrite(actor);
  const current = await getPrisma().policy.findFirst({
    where: { id: policyId, organizationId: actor.organization.id },
  });
  if (!current) {
    throw new ApiError(404, "NOT_FOUND", "Policy not found.");
  }
  if (input.name && input.name !== current.name) {
    const duplicate = await getPrisma().policy.findFirst({
      where: { organizationId: actor.organization.id, name: input.name, NOT: { id: current.id } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ApiError(409, "NAME_IN_USE", "A policy with that name already exists.");
    }
  }
  const updated = await getPrisma().$transaction(async (tx) => {
    const policy = await tx.policy.update({
      where: { id: current.id },
      data: {
        name: input.name,
        strategy: input.strategy,
        timeoutMs: input.timeoutMs,
        maxRetries: input.maxRetries,
        cooldownSeconds: input.cooldownSeconds,
        sessionTtlSeconds: input.sessionTtlSeconds,
        maxConcurrency: input.maxConcurrency,
        requestsPerSecond: input.requestsPerSecond,
        enabled: input.enabled,
      },
      include: { _count: { select: { pools: true } } },
    });
    await audit(tx, {
      organizationId: actor.organization.id,
      userId: actor.id,
      action: "SETTINGS_CHANGED",
      resource: "policy",
      resourceId: policy.id,
      ip: meta.ip,
      metadata: { name: policy.name, strategy: policy.strategy },
    });
    return policy;
  });
  return toPolicy(updated);
}

export async function deletePolicy(actor: PublicUser, policyId: string, meta: RequestMeta): Promise<void> {
  assertDelete(actor);
  const current = await getPrisma().policy.findFirst({
    where: { id: policyId, organizationId: actor.organization.id },
  });
  if (!current) {
    throw new ApiError(404, "NOT_FOUND", "Policy not found.");
  }
  await getPrisma().$transaction(async (tx) => {
    await audit(tx, {
      organizationId: actor.organization.id,
      userId: actor.id,
      action: "SETTINGS_CHANGED",
      resource: "policy",
      resourceId: current.id,
      ip: meta.ip,
      metadata: { name: current.name, deleted: true },
    });
    await tx.policy.delete({ where: { id: current.id } });
  });
}

export async function listProxySessions(actor: PublicUser): Promise<PublicProxySession[]> {
  const rows = await getPrisma().proxySession.findMany({
    where: {
      organizationId: actor.organization.id,
      expiresAt: { gt: new Date() },
      ...(canListAllApiKeys(actor.role) ? {} : { userId: actor.id }),
    },
    include: { proxy: { select: { host: true, port: true, protocol: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    policyId: row.policyId,
    proxyId: row.proxyId,
    host: row.proxy.host,
    port: row.proxy.port,
    protocol: row.proxy.protocol,
    expiresAt: row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt.toISOString(),
  }));
}

export async function releaseProxySession(actor: PublicUser, sessionId: string): Promise<void> {
  const current = await getPrisma().proxySession.findFirst({
    where: { id: sessionId, organizationId: actor.organization.id },
  });
  if (!current) {
    throw new ApiError(404, "NOT_FOUND", "Proxy session not found.");
  }
  if (!canListAllApiKeys(actor.role) && current.userId !== actor.id) {
    throw new ApiError(403, "FORBIDDEN", "You cannot release that proxy session.");
  }
  await getPrisma().proxySession.delete({ where: { id: current.id } });
}

function toSelectionProxy(proxy: RotationCandidate & { host: string; port: number; protocol: string }): ProxySelection["proxy"] {
  return {
    id: proxy.id,
    host: proxy.host,
    port: proxy.port,
    protocol: proxy.protocol,
    status: proxy.status,
    healthScore: proxy.healthScore,
    avgLatencyMs: proxy.avgLatencyMs,
  };
}

export async function selectPoolProxy(
  actor: PublicUser,
  poolId: string,
  nextCursor: (organizationId: string, poolId: string) => Promise<number>,
  now = new Date(),
): Promise<ProxySelection> {
  const pool = await getPrisma().pool.findFirst({
    where: { id: poolId, organizationId: actor.organization.id },
    include: {
      policy: true,
      poolProxies: {
        include: {
          proxy: {
            select: {
              id: true,
              host: true,
              port: true,
              protocol: true,
              status: true,
              healthScore: true,
              avgLatencyMs: true,
              cooldownUntil: true,
            },
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
  const strategy = policy?.strategy ?? pool.strategy;
  if (strategy === "STICKY_SESSION" && !policy) {
    throw new ApiError(409, "POLICY_REQUIRED", "Sticky rotation needs an enabled policy on the pool.");
  }
  const candidates = pool.poolProxies.map((entry) => entry.proxy);
  const chosenFrom = (cursor: number) =>
    pickProxy({
      strategy: strategy === "STICKY_SESSION" ? "ROUND_ROBIN" : strategy,
      candidates,
      cursor,
      now,
    });

  if (strategy === "STICKY_SESSION" && policy) {
    const active = await getPrisma().proxySession.findFirst({
      where: { organizationId: actor.organization.id, userId: actor.id, policyId: policy.id, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });
    const bound = active ? candidates.find((proxy) => proxy.id === active.proxyId) : undefined;
    const boundChoice = bound
      ? pickProxy({ strategy: "ROUND_ROBIN", candidates: [bound], cursor: 1, now })
      : null;
    if (active && bound && boundChoice) {
      await getPrisma().proxySession.update({ where: { id: active.id }, data: { lastUsedAt: now } });
      return {
        poolId: pool.id,
        strategy,
        proxy: toSelectionProxy(bound),
        session: { id: active.id, expiresAt: active.expiresAt.toISOString() },
      };
    }
    const cursor = await nextCursor(actor.organization.id, pool.id);
    const picked = chosenFrom(cursor);
    if (!picked) {
      throw new ApiError(409, "NO_ELIGIBLE_PROXY", "No eligible proxy is available in this pool.");
    }
    const expiresAt = new Date(now.getTime() + policy.sessionTtlSeconds * 1000);
    const session = active
      ? await getPrisma().proxySession.update({
          where: { id: active.id },
          data: { proxyId: picked.id, expiresAt, lastUsedAt: now },
        })
      : await getPrisma().proxySession.create({
          data: {
            organizationId: actor.organization.id,
            userId: actor.id,
            policyId: policy.id,
            proxyId: picked.id,
            expiresAt,
            lastUsedAt: now,
          },
        });
    const proxy = candidates.find((entry) => entry.id === picked.id);
    if (!proxy) {
      throw new ApiError(409, "NO_ELIGIBLE_PROXY", "No eligible proxy is available in this pool.");
    }
    return {
      poolId: pool.id,
      strategy,
      proxy: toSelectionProxy(proxy),
      session: { id: session.id, expiresAt: session.expiresAt.toISOString() },
    };
  }

  const cursor = strategy === "ROUND_ROBIN" ? await nextCursor(actor.organization.id, pool.id) : 1;
  const picked = pickProxy({ strategy, candidates, cursor, now });
  if (!picked) {
    throw new ApiError(409, "NO_ELIGIBLE_PROXY", "No eligible proxy is available in this pool.");
  }
  const proxy = candidates.find((entry) => entry.id === picked.id);
  if (!proxy) {
    throw new ApiError(409, "NO_ELIGIBLE_PROXY", "No eligible proxy is available in this pool.");
  }
  return { poolId: pool.id, strategy, proxy: toSelectionProxy(proxy), session: null };
}
