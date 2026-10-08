import { encryptString, getPrisma } from "@proxypilot/database";
import {
  DEFAULT_COOLDOWN_SECONDS,
  DEFAULT_HEALTH_THRESHOLDS,
  PoolStatus,
  ProviderStatus,
  ProxyStatus,
  canDeleteInventory,
  canWriteInventory,
  statusForScore,
} from "@proxypilot/shared";
import type { HealthThresholds } from "@proxypilot/shared";
import type {
  PoolStatus as PoolStatusName,
  ProviderStatus as ProviderStatusName,
  ProviderType as ProviderTypeName,
  ProxyProtocol as ProxyProtocolName,
  ProxyStatus as ProxyStatusName,
  RotationStrategy as RotationStrategyName,
} from "@proxypilot/shared";
import type { Prisma } from "@prisma/client";
import { ApiError } from "../http-error.js";
import type { PublicUser } from "../auth/service.js";
import { parseProxyImport, type ParsedProxy } from "./parse.js";

type RequestMeta = { ip: string | null };

export type PublicProvider = {
  id: string;
  name: string;
  type: ProviderTypeName;
  protocol: ProxyProtocolName;
  status: ProviderStatusName;
  metadata: Prisma.JsonValue;
  hasCredentials: boolean;
  proxyCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PublicProxy = {
  id: string;
  providerId: string;
  host: string;
  port: number;
  protocol: ProxyProtocolName;
  country: string | null;
  region: string | null;
  city: string | null;
  status: ProxyStatusName;
  healthScore: number;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number | null;
  lastCheckedAt: string | null;
  cooldownUntil: string | null;
  hasUsername: boolean;
  hasPassword: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type PublicTag = {
  id: string;
  name: string;
  proxyCount: number;
};

export type PublicPool = {
  id: string;
  name: string;
  description: string | null;
  strategy: RotationStrategyName;
  status: PoolStatusName;
  policyId: string | null;
  proxyIds: string[];
  createdAt: string;
  updatedAt: string;
};

const proxyInclude = {
  proxyTags: { include: { tag: true } },
} as const;

type ProxyRow = Prisma.ProxyGetPayload<{ include: typeof proxyInclude }>;

function assertWrite(actor: PublicUser): void {
  if (!canWriteInventory(actor.role)) {
    throw new ApiError(403, "FORBIDDEN", "You cannot change inventory.");
  }
}

function assertDelete(actor: PublicUser): void {
  if (!canDeleteInventory(actor.role)) {
    throw new ApiError(403, "FORBIDDEN", "You cannot delete inventory.");
  }
}

function seal(value: string | null | undefined, key: Buffer): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  return encryptString(value, key);
}

function sealProviderCredentials(
  input: { username?: string | null; password?: string | null },
  key: Buffer,
): string | null | undefined {
  if (input.username === undefined && input.password === undefined) {
    return undefined;
  }
  const username = input.username?.trim() ?? "";
  const password = input.password ?? "";
  if (!username && !password) {
    return null;
  }
  return encryptString(JSON.stringify({ username, password }), key);
}

function toProvider(row: {
  id: string;
  name: string;
  type: ProviderTypeName;
  protocol: ProxyProtocolName;
  status: ProviderStatusName;
  metadata: Prisma.JsonValue;
  credentialsEncrypted: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { proxies: number };
}): PublicProvider {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    protocol: row.protocol,
    status: row.status,
    metadata: row.metadata,
    hasCredentials: row.credentialsEncrypted !== null,
    proxyCount: row._count.proxies,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toProxy(row: ProxyRow): PublicProxy {
  return {
    id: row.id,
    providerId: row.providerId,
    host: row.host,
    port: row.port,
    protocol: row.protocol,
    country: row.country,
    region: row.region,
    city: row.city,
    status: row.status,
    healthScore: row.healthScore,
    successCount: row.successCount,
    failureCount: row.failureCount,
    avgLatencyMs: row.avgLatencyMs,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    cooldownUntil: row.cooldownUntil?.toISOString() ?? null,
    hasUsername: row.usernameEncrypted !== null,
    hasPassword: row.passwordEncrypted !== null,
    tags: row.proxyTags.map((entry) => entry.tag.name).sort(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function audit(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    userId: string;
    action: Prisma.AuditLogCreateInput["action"];
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

async function requireProvider(organizationId: string, providerId: string) {
  const provider = await getPrisma().provider.findFirst({
    where: { id: providerId, organizationId },
  });
  if (!provider) {
    throw new ApiError(404, "NOT_FOUND", "Provider not found.");
  }
  return provider;
}

async function requireProxy(organizationId: string, proxyId: string) {
  const proxy = await getPrisma().proxy.findFirst({
    where: { id: proxyId, organizationId },
    include: proxyInclude,
  });
  if (!proxy) {
    throw new ApiError(404, "NOT_FOUND", "Proxy not found.");
  }
  return proxy;
}

export async function listProviders(actor: PublicUser): Promise<PublicProvider[]> {
  const rows = await getPrisma().provider.findMany({
    where: { organizationId: actor.organization.id },
    include: { _count: { select: { proxies: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toProvider);
}

export async function createProvider(
  actor: PublicUser,
  key: Buffer,
  input: {
    name: string;
    type: ProviderTypeName;
    protocol: ProxyProtocolName;
    metadata: Prisma.InputJsonValue;
    username?: string | null;
    password?: string | null;
  },
  meta: RequestMeta,
): Promise<PublicProvider> {
  assertWrite(actor);
  const prisma = getPrisma();
  const duplicate = await prisma.provider.findFirst({
    where: { organizationId: actor.organization.id, name: input.name },
    select: { id: true },
  });
  if (duplicate) {
    throw new ApiError(409, "NAME_IN_USE", "A provider with that name already exists.");
  }
  const credentials = sealProviderCredentials(input, key);
  const created = await prisma.$transaction(async (tx) => {
    const provider = await tx.provider.create({
      data: {
        organizationId: actor.organization.id,
        name: input.name,
        type: input.type,
        protocol: input.protocol,
        metadata: input.metadata,
        credentialsEncrypted: credentials ?? null,
        status: ProviderStatus.ACTIVE,
      },
      include: { _count: { select: { proxies: true } } },
    });
    await audit(tx, {
      organizationId: actor.organization.id,
      userId: actor.id,
      action: "PROVIDER_CREATED",
      resource: "provider",
      resourceId: provider.id,
      ip: meta.ip,
      metadata: { name: provider.name, type: provider.type },
    });
    return provider;
  });
  return toProvider(created);
}

export async function updateProvider(
  actor: PublicUser,
  key: Buffer,
  providerId: string,
  input: {
    name?: string;
    type?: ProviderTypeName;
    protocol?: ProxyProtocolName;
    status?: ProviderStatusName;
    metadata?: Prisma.InputJsonValue;
    username?: string | null;
    password?: string | null;
  },
  meta: RequestMeta,
): Promise<PublicProvider> {
  assertWrite(actor);
  const current = await requireProvider(actor.organization.id, providerId);
  if (input.name && input.name !== current.name) {
    const duplicate = await getPrisma().provider.findFirst({
      where: { organizationId: actor.organization.id, name: input.name, id: { not: current.id } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ApiError(409, "NAME_IN_USE", "A provider with that name already exists.");
    }
  }
  const credentials = sealProviderCredentials(input, key);
  const updated = await getPrisma().$transaction(async (tx) => {
    const provider = await tx.provider.update({
      where: { id: current.id },
      data: {
        name: input.name,
        type: input.type,
        protocol: input.protocol,
        status: input.status,
        metadata: input.metadata,
        ...(credentials !== undefined ? { credentialsEncrypted: credentials } : {}),
      },
      include: { _count: { select: { proxies: true } } },
    });
    await audit(tx, {
      organizationId: actor.organization.id,
      userId: actor.id,
      action: "SETTINGS_CHANGED",
      resource: "provider",
      resourceId: provider.id,
      ip: meta.ip,
      metadata: { name: provider.name, status: provider.status },
    });
    return provider;
  });
  return toProvider(updated);
}

export async function deleteProvider(actor: PublicUser, providerId: string, meta: RequestMeta): Promise<void> {
  assertDelete(actor);
  const current = await requireProvider(actor.organization.id, providerId);
  await getPrisma().$transaction(async (tx) => {
    await audit(tx, {
      organizationId: actor.organization.id,
      userId: actor.id,
      action: "PROXY_DELETED",
      resource: "provider",
      resourceId: current.id,
      ip: meta.ip,
      metadata: { name: current.name },
    });
    await tx.provider.delete({ where: { id: current.id } });
  });
}

export async function listProxies(
  actor: PublicUser,
  filter: { providerId?: string; status?: ProxyStatusName; tag?: string; poolId?: string },
): Promise<PublicProxy[]> {
  const rows = await getPrisma().proxy.findMany({
    where: {
      organizationId: actor.organization.id,
      ...(filter.providerId ? { providerId: filter.providerId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.tag
        ? { proxyTags: { some: { tag: { organizationId: actor.organization.id, name: filter.tag } } } }
        : {}),
      ...(filter.poolId ? { poolProxies: { some: { poolId: filter.poolId } } } : {}),
    },
    include: proxyInclude,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toProxy);
}

async function ensureTags(tx: Prisma.TransactionClient, organizationId: string, names: string[]): Promise<string[]> {
  const unique = [...new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean))];
  const ids: string[] = [];
  for (const name of unique) {
    const tag = await tx.tag.upsert({
      where: { organizationId_name: { organizationId, name } },
      update: {},
      create: { organizationId, name },
    });
    ids.push(tag.id);
  }
  return ids;
}

async function replaceTags(tx: Prisma.TransactionClient, organizationId: string, proxyId: string, names: string[]) {
  const tagIds = await ensureTags(tx, organizationId, names);
  await tx.proxyTag.deleteMany({ where: { proxyId } });
  if (tagIds.length > 0) {
    await tx.proxyTag.createMany({ data: tagIds.map((tagId) => ({ proxyId, tagId })) });
  }
}

async function assertUniqueEndpoint(
  organizationId: string,
  host: string,
  port: number,
  protocol: ProxyProtocolName,
  ignoreId?: string,
): Promise<void> {
  const existing = await getPrisma().proxy.findFirst({
    where: {
      organizationId,
      host,
      port,
      protocol,
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
    },
    select: { id: true },
  });
  if (existing) {
    throw new ApiError(409, "PROXY_EXISTS", "That host, port, and protocol are already in the organization.");
  }
}

export async function createProxy(
  actor: PublicUser,
  key: Buffer,
  input: {
    providerId: string;
    host: string;
    port: number;
    protocol?: ProxyProtocolName;
    username?: string | null;
    password?: string | null;
    country?: string | null;
    region?: string | null;
    city?: string | null;
    tagNames?: string[];
  },
  meta: RequestMeta,
): Promise<PublicProxy> {
  assertWrite(actor);
  const provider = await requireProvider(actor.organization.id, input.providerId);
  const protocol = input.protocol ?? provider.protocol;
  await assertUniqueEndpoint(actor.organization.id, input.host, input.port, protocol);
  const created = await getPrisma().$transaction(async (tx) => {
    const proxy = await tx.proxy.create({
      data: {
        organizationId: actor.organization.id,
        providerId: provider.id,
        host: input.host,
        port: input.port,
        protocol,
        usernameEncrypted: seal(input.username, key) ?? null,
        passwordEncrypted: seal(input.password, key) ?? null,
        country: input.country ?? null,
        region: input.region ?? null,
        city: input.city ?? null,
        status: ProxyStatus.HEALTHY,
      },
    });
    if (input.tagNames) {
      await replaceTags(tx, actor.organization.id, proxy.id, input.tagNames);
    }
    await audit(tx, {
      organizationId: actor.organization.id,
      userId: actor.id,
      action: "PROXY_CREATED",
      resource: "proxy",
      resourceId: proxy.id,
      ip: meta.ip,
      metadata: { host: proxy.host, port: proxy.port, protocol: proxy.protocol },
    });
    return tx.proxy.findUniqueOrThrow({ where: { id: proxy.id }, include: proxyInclude });
  });
  return toProxy(created);
}

export async function updateProxy(
  actor: PublicUser,
  key: Buffer,
  proxyId: string,
  input: {
    host?: string;
    port?: number;
    protocol?: ProxyProtocolName;
    username?: string | null;
    password?: string | null;
    country?: string | null;
    region?: string | null;
    city?: string | null;
    tagNames?: string[];
  },
  meta: RequestMeta,
): Promise<PublicProxy> {
  assertWrite(actor);
  const current = await requireProxy(actor.organization.id, proxyId);
  const host = input.host ?? current.host;
  const port = input.port ?? current.port;
  const protocol = input.protocol ?? current.protocol;
  if (host !== current.host || port !== current.port || protocol !== current.protocol) {
    await assertUniqueEndpoint(actor.organization.id, host, port, protocol, current.id);
  }
  const username = seal(input.username, key);
  const password = seal(input.password, key);
  const updated = await getPrisma().$transaction(async (tx) => {
    await tx.proxy.update({
      where: { id: current.id },
      data: {
        host: input.host,
        port: input.port,
        protocol: input.protocol,
        country: input.country,
        region: input.region,
        city: input.city,
        ...(username !== undefined ? { usernameEncrypted: username } : {}),
        ...(password !== undefined ? { passwordEncrypted: password } : {}),
      },
    });
    if (input.tagNames) {
      await replaceTags(tx, actor.organization.id, current.id, input.tagNames);
    }
    await audit(tx, {
      organizationId: actor.organization.id,
      userId: actor.id,
      action: "PROXY_UPDATED",
      resource: "proxy",
      resourceId: current.id,
      ip: meta.ip,
      metadata: { host, port, protocol },
    });
    return tx.proxy.findUniqueOrThrow({ where: { id: current.id }, include: proxyInclude });
  });
  return toProxy(updated);
}

export async function setProxyEnabled(
  actor: PublicUser,
  proxyId: string,
  enabled: boolean,
  meta: RequestMeta,
  policy: { cooldownSeconds: number; thresholds: HealthThresholds } = {
    cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
    thresholds: DEFAULT_HEALTH_THRESHOLDS,
  },
): Promise<PublicProxy> {
  assertWrite(actor);
  const current = await requireProxy(actor.organization.id, proxyId);
  const status = enabled ? statusForScore(current.healthScore, policy.thresholds) : ProxyStatus.DISABLED;
  const cooldownUntil =
    status === ProxyStatus.QUARANTINED ? new Date(Date.now() + policy.cooldownSeconds * 1000) : null;
  const updated = await getPrisma().$transaction(async (tx) => {
    await tx.proxy.update({ where: { id: current.id }, data: { status, cooldownUntil } });
    await audit(tx, {
      organizationId: actor.organization.id,
      userId: actor.id,
      action: enabled ? "PROXY_ENABLED" : "PROXY_DISABLED",
      resource: "proxy",
      resourceId: current.id,
      ip: meta.ip,
      metadata: { host: current.host, port: current.port },
    });
    return tx.proxy.findUniqueOrThrow({ where: { id: current.id }, include: proxyInclude });
  });
  return toProxy(updated);
}

export async function deleteProxy(actor: PublicUser, proxyId: string, meta: RequestMeta): Promise<void> {
  assertDelete(actor);
  const current = await requireProxy(actor.organization.id, proxyId);
  await getPrisma().$transaction(async (tx) => {
    await audit(tx, {
      organizationId: actor.organization.id,
      userId: actor.id,
      action: "PROXY_DELETED",
      resource: "proxy",
      resourceId: current.id,
      ip: meta.ip,
      metadata: { host: current.host, port: current.port },
    });
    await tx.proxy.delete({ where: { id: current.id } });
  });
}

export async function importProxies(
  actor: PublicUser,
  key: Buffer,
  input: { providerId: string; text: string; protocol?: ProxyProtocolName },
  meta: RequestMeta,
): Promise<{ created: number; skipped: number; errors: { line: number; message: string }[] }> {
  assertWrite(actor);
  const provider = await requireProvider(actor.organization.id, input.providerId);
  let parsed: ReturnType<typeof parseProxyImport>;
  try {
    parsed = parseProxyImport(input.text);
  } catch (error) {
    throw new ApiError(400, "VALIDATION_ERROR", error instanceof Error ? error.message : "Could not parse the import.");
  }
  if (parsed.proxies.length === 0 && parsed.errors.length === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "The import did not contain any proxies.");
  }
  const existing = await getPrisma().proxy.findMany({
    where: { organizationId: actor.organization.id },
    select: { host: true, port: true, protocol: true },
  });
  const seen = new Set(existing.map((row) => `${row.protocol}|${row.host}|${row.port}`));
  const fresh: ParsedProxy[] = [];
  let skipped = 0;
  for (const proxy of parsed.proxies) {
    const protocol = proxy.protocol ?? input.protocol ?? provider.protocol;
    const identity = `${protocol}|${proxy.host}|${proxy.port}`;
    if (seen.has(identity)) {
      skipped += 1;
      continue;
    }
    seen.add(identity);
    fresh.push({ ...proxy, protocol });
  }
  if (fresh.length > 0) {
    await getPrisma().$transaction(async (tx) => {
      for (const proxy of fresh) {
        await tx.proxy.create({
          data: {
            organizationId: actor.organization.id,
            providerId: provider.id,
            host: proxy.host,
            port: proxy.port,
            protocol: proxy.protocol ?? provider.protocol,
            usernameEncrypted: seal(proxy.username, key) ?? null,
            passwordEncrypted: seal(proxy.password, key) ?? null,
            country: proxy.country ?? null,
            status: ProxyStatus.HEALTHY,
          },
        });
      }
      await audit(tx, {
        organizationId: actor.organization.id,
        userId: actor.id,
        action: "PROXY_CREATED",
        resource: "proxy_import",
        resourceId: provider.id,
        ip: meta.ip,
        metadata: { created: fresh.length, skipped },
      });
    });
  }
  return { created: fresh.length, skipped, errors: parsed.errors };
}

export async function listTags(actor: PublicUser): Promise<PublicTag[]> {
  const tags = await getPrisma().tag.findMany({
    where: { organizationId: actor.organization.id },
    include: { _count: { select: { proxyTags: true } } },
    orderBy: { name: "asc" },
  });
  return tags.map((tag) => ({ id: tag.id, name: tag.name, proxyCount: tag._count.proxyTags }));
}

export async function deleteTag(actor: PublicUser, tagId: string, meta: RequestMeta): Promise<void> {
  assertDelete(actor);
  const tag = await getPrisma().tag.findFirst({
    where: { id: tagId, organizationId: actor.organization.id },
  });
  if (!tag) {
    throw new ApiError(404, "NOT_FOUND", "Tag not found.");
  }
  await getPrisma().$transaction(async (tx) => {
    await audit(tx, {
      organizationId: actor.organization.id,
      userId: actor.id,
      action: "SETTINGS_CHANGED",
      resource: "tag",
      resourceId: tag.id,
      ip: meta.ip,
      metadata: { name: tag.name, deleted: true },
    });
    await tx.tag.delete({ where: { id: tag.id } });
  });
}

export async function listPools(actor: PublicUser): Promise<PublicPool[]> {
  const pools = await getPrisma().pool.findMany({
    where: { organizationId: actor.organization.id },
    include: { poolProxies: true },
    orderBy: { createdAt: "asc" },
  });
  return pools.map((pool) => ({
    id: pool.id,
    name: pool.name,
    description: pool.description,
    strategy: pool.strategy,
    status: pool.status,
    policyId: pool.policyId,
    proxyIds: pool.poolProxies.map((entry) => entry.proxyId),
    createdAt: pool.createdAt.toISOString(),
    updatedAt: pool.updatedAt.toISOString(),
  }));
}

export async function createPool(
  actor: PublicUser,
  input: { name: string; description?: string | null; strategy: RotationStrategyName; policyId?: string | null },
  meta: RequestMeta,
): Promise<PublicPool> {
  assertWrite(actor);
  if (input.policyId) {
    const policy = await getPrisma().policy.findFirst({
      where: { id: input.policyId, organizationId: actor.organization.id },
      select: { id: true },
    });
    if (!policy) {
      throw new ApiError(404, "NOT_FOUND", "Policy not found.");
    }
  }
  const duplicate = await getPrisma().pool.findFirst({
    where: { organizationId: actor.organization.id, name: input.name },
    select: { id: true },
  });
  if (duplicate) {
    throw new ApiError(409, "NAME_IN_USE", "A pool with that name already exists.");
  }
  const created = await getPrisma().$transaction(async (tx) => {
    const pool = await tx.pool.create({
      data: {
        organizationId: actor.organization.id,
        name: input.name,
        description: input.description ?? null,
        strategy: input.strategy,
        policyId: input.policyId ?? null,
        status: PoolStatus.ACTIVE,
      },
    });
    await audit(tx, {
      organizationId: actor.organization.id,
      userId: actor.id,
      action: "SETTINGS_CHANGED",
      resource: "pool",
      resourceId: pool.id,
      ip: meta.ip,
      metadata: { name: pool.name, strategy: pool.strategy },
    });
    return pool;
  });
  return {
    id: created.id,
    name: created.name,
    description: created.description,
    strategy: created.strategy,
    status: created.status,
    policyId: created.policyId,
    proxyIds: [],
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

export async function setPoolProxies(
  actor: PublicUser,
  poolId: string,
  proxyIds: string[],
  meta: RequestMeta,
): Promise<PublicPool> {
  assertWrite(actor);
  const pool = await getPrisma().pool.findFirst({
    where: { id: poolId, organizationId: actor.organization.id },
  });
  if (!pool) {
    throw new ApiError(404, "NOT_FOUND", "Pool not found.");
  }
  const unique = [...new Set(proxyIds)];
  const owned = await getPrisma().proxy.findMany({
    where: { organizationId: actor.organization.id, id: { in: unique } },
    select: { id: true },
  });
  if (owned.length !== unique.length) {
    throw new ApiError(400, "VALIDATION_ERROR", "One or more proxies are not in this organization.");
  }
  await getPrisma().$transaction(async (tx) => {
    await tx.poolProxy.deleteMany({ where: { poolId: pool.id } });
    if (unique.length > 0) {
      await tx.poolProxy.createMany({ data: unique.map((proxyId) => ({ poolId: pool.id, proxyId })) });
    }
    await audit(tx, {
      organizationId: actor.organization.id,
      userId: actor.id,
      action: "SETTINGS_CHANGED",
      resource: "pool",
      resourceId: pool.id,
      ip: meta.ip,
      metadata: { proxies: unique.length },
    });
  });
  const pools = await listPools(actor);
  const updated = pools.find((entry) => entry.id === pool.id);
  if (!updated) {
    throw new ApiError(404, "NOT_FOUND", "Pool not found.");
  }
  return updated;
}