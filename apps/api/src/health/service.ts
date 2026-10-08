import { getPrisma } from "@proxypilot/database";
import { canWriteInventory } from "@proxypilot/shared";
import type { PublicUser } from "../auth/service.js";
import { ApiError } from "../http-error.js";

export type PublicHealthCheck = {
  id: string;
  proxyId: string;
  host: string;
  port: number;
  status: "SUCCESS" | "FAILED";
  latencyMs: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  checkedAt: string;
};

export async function listHealthChecks(
  actor: PublicUser,
  query: { proxyId?: string; limit: number },
): Promise<PublicHealthCheck[]> {
  if (query.proxyId) {
    const proxy = await getPrisma().proxy.findFirst({
      where: { id: query.proxyId, organizationId: actor.organization.id },
      select: { id: true },
    });
    if (!proxy) {
      throw new ApiError(404, "NOT_FOUND", "Proxy not found.");
    }
  }
  const rows = await getPrisma().healthCheck.findMany({
    where: {
      proxy: {
        organizationId: actor.organization.id,
        ...(query.proxyId ? { id: query.proxyId } : {}),
      },
    },
    orderBy: { checkedAt: "desc" },
    take: query.limit,
    include: { proxy: { select: { host: true, port: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    proxyId: row.proxyId,
    host: row.proxy.host,
    port: row.proxy.port,
    status: row.status,
    latencyMs: row.latencyMs,
    httpStatus: row.httpStatus,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    checkedAt: row.checkedAt.toISOString(),
  }));
}

export async function requestHealthCheck(
  actor: PublicUser,
  proxyId: string,
  enqueue: ((proxyId: string) => Promise<"queued" | "already">) | undefined,
): Promise<{ queued: true; alreadyQueued: boolean }> {
  if (!canWriteInventory(actor.role)) {
    throw new ApiError(403, "FORBIDDEN", "You cannot change inventory.");
  }
  if (!enqueue) {
    throw new ApiError(503, "HEALTH_UNAVAILABLE", "Health checks are not configured.");
  }
  const proxy = await getPrisma().proxy.findFirst({
    where: { id: proxyId, organizationId: actor.organization.id },
    select: { id: true },
  });
  if (!proxy) {
    throw new ApiError(404, "NOT_FOUND", "Proxy not found.");
  }
  const result = await enqueue(proxy.id);
  return { queued: true, alreadyQueued: result === "already" };
}
