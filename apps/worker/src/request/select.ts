import { decryptString, getPrisma } from "@proxypilot/database";
import { PoolStatus, eligibleProxies, pickProxy } from "@proxypilot/shared";

export class RequestStop extends Error {
  readonly errorCode: string;

  constructor(errorCode: string) {
    super(errorCode);
    this.name = "RequestStop";
    this.errorCode = errorCode;
  }
}

export type SelectedProxy = {
  policy: { id: string; timeoutMs: number; maxRetries: number };
  proxy: {
    id: string;
    host: string;
    port: number;
    protocol: "HTTP" | "HTTPS" | "SOCKS5";
    usernameEncrypted: string | null;
    passwordEncrypted: string | null;
  };
  sessionId: string | null;
};

export async function selectForRequest(input: {
  organizationId: string;
  userId: string;
  poolId: string;
  nextCursor: (organizationId: string, poolId: string) => Promise<number>;
  excludeProxyIds?: string[];
  now?: Date;
}): Promise<SelectedProxy> {
  const now = input.now ?? new Date();
  const pool = await getPrisma().pool.findFirst({
    where: { id: input.poolId, organizationId: input.organizationId },
    include: {
      policy: true,
      poolProxies: { include: { proxy: true } },
    },
  });
  if (!pool) {
    throw new RequestStop("NOT_FOUND");
  }
  if (pool.status === PoolStatus.DISABLED) {
    throw new RequestStop("POOL_DISABLED");
  }
  const policy = pool.policy && pool.policy.enabled ? pool.policy : null;
  if (!policy) {
    throw new RequestStop("POLICY_REQUIRED");
  }
  const strategy = policy.strategy;
  let proxies = pool.poolProxies.map((entry) => entry.proxy);
  if (strategy !== "STICKY_SESSION" && input.excludeProxyIds && input.excludeProxyIds.length > 0) {
    const excluded = new Set(input.excludeProxyIds);
    const kept = proxies.filter((proxy) => !excluded.has(proxy.id));
    if (eligibleProxies(kept, now).length > 0) {
      proxies = kept;
    }
  }
  const chosenFrom = (cursor: number) =>
    pickProxy({
      strategy: strategy === "STICKY_SESSION" ? "ROUND_ROBIN" : strategy,
      candidates: proxies,
      cursor,
      now,
    });

  const finish = (proxyId: string, sessionId: string | null): SelectedProxy => {
    const proxy = pool.poolProxies.map((entry) => entry.proxy).find((entry) => entry.id === proxyId);
    if (!proxy) {
      throw new RequestStop("NO_ELIGIBLE_PROXY");
    }
    return {
      policy: { id: policy.id, timeoutMs: policy.timeoutMs, maxRetries: policy.maxRetries },
      proxy: {
        id: proxy.id,
        host: proxy.host,
        port: proxy.port,
        protocol: proxy.protocol,
        usernameEncrypted: proxy.usernameEncrypted,
        passwordEncrypted: proxy.passwordEncrypted,
      },
      sessionId,
    };
  };

  if (strategy === "STICKY_SESSION") {
    const active = await getPrisma().proxySession.findFirst({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        policyId: policy.id,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });
    const bound = active ? proxies.find((proxy) => proxy.id === active.proxyId) : undefined;
    const boundChoice = bound ? pickProxy({ strategy: "ROUND_ROBIN", candidates: [bound], cursor: 1, now }) : null;
    if (active && bound && boundChoice) {
      await getPrisma().proxySession.update({ where: { id: active.id }, data: { lastUsedAt: now } });
      return finish(bound.id, active.id);
    }
    const cursor = await input.nextCursor(input.organizationId, pool.id);
    const picked = chosenFrom(cursor);
    if (!picked) {
      throw new RequestStop("NO_ELIGIBLE_PROXY");
    }
    const expiresAt = new Date(now.getTime() + policy.sessionTtlSeconds * 1000);
    const session = active
      ? await getPrisma().proxySession.update({
          where: { id: active.id },
          data: { proxyId: picked.id, expiresAt, lastUsedAt: now },
        })
      : await getPrisma().proxySession.create({
          data: {
            organizationId: input.organizationId,
            userId: input.userId,
            policyId: policy.id,
            proxyId: picked.id,
            expiresAt,
            lastUsedAt: now,
          },
        });
    return finish(picked.id, session.id);
  }

  const cursor = strategy === "ROUND_ROBIN" ? await input.nextCursor(input.organizationId, pool.id) : 1;
  const picked = chosenFrom(cursor);
  if (!picked) {
    throw new RequestStop("NO_ELIGIBLE_PROXY");
  }
  return finish(picked.id, null);
}

export function readProxySecret(payload: string | null, key: Buffer): string | undefined {
  if (!payload) {
    return undefined;
  }
  return decryptString(payload, key);
}
