import { getPrisma } from "@proxypilot/database";
import { canListAllApiKeys } from "@proxypilot/shared";
import type { PublicUser } from "../auth/service.js";
import { ApiError } from "../http-error.js";

const SECRET_KEY = /password|secret|token|authorization|cookie|credential|apikey|api_key/i;
const USERINFO = /([a-z][a-z0-9+.-]*:\/\/)[^/\s@]*@/gi;

export type PublicAuditEvent = {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  actorEmail: string | null;
  ip: string | null;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
};

export function publicAuditMetadata(value: unknown): PublicAuditEvent["metadata"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const metadata: PublicAuditEvent["metadata"] = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      continue;
    }
    if (typeof entry === "string") {
      metadata[key] = entry.replace(USERINFO, "$1").slice(0, 200);
    } else if (typeof entry === "number" || typeof entry === "boolean" || entry === null) {
      metadata[key] = entry;
    }
  }
  return metadata;
}

export async function listAuditEvents(actor: PublicUser, limit: number): Promise<PublicAuditEvent[]> {
  if (!canListAllApiKeys(actor.role)) {
    throw new ApiError(403, "FORBIDDEN", "Audit logs are available to owners and admins.");
  }
  const rows = await getPrisma().auditLog.findMany({
    where: { organizationId: actor.organization.id },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { email: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    resource: row.resource,
    resourceId: row.resourceId,
    actorEmail: row.user?.email ?? null,
    ip: row.ip,
    metadata: publicAuditMetadata(row.metadata),
    createdAt: row.createdAt.toISOString(),
  }));
}
