import { getPrisma } from "@proxypilot/database";
import { canListAllApiKeys, usagePeriodStart } from "@proxypilot/shared";
import type { PublicUser } from "../auth/service.js";

export type AnalyticsSnapshot = {
  windowHours: number;
  scope: "organization" | "user";
  proxies: {
    total: number;
    healthy: number;
    degraded: number;
    quarantined: number;
    disabled: number;
  };
  requests: {
    total: number;
    completed: number;
    failed: number;
    active: number;
    avgLatencyMs: number | null;
  };
  usage: {
    metric: "requests";
    periodStart: string;
    quantity: string;
  };
  domains: Array<{ domain: string; count: number; avgLatencyMs: number | null }>;
  hours: Array<{ start: string; completed: number; failed: number }>;
  recent: Array<{
    id: string;
    method: string;
    domain: string;
    status: string;
    httpStatus: number | null;
    latencyMs: number | null;
    createdAt: string;
  }>;
};

type HourRow = {
  bucket: Date;
  status: string;
  count: bigint;
};

function countStatus(groups: Array<{ status: string; _count: { _all: number } }>, status: string): number {
  return groups.find((group) => group.status === status)?._count._all ?? 0;
}

function hourSeries(hours: number, rows: HourRow[], now: Date): AnalyticsSnapshot["hours"] {
  const endHour = new Date(now);
  endHour.setUTCMinutes(0, 0, 0);
  const series: AnalyticsSnapshot["hours"] = [];
  for (let index = hours - 1; index >= 0; index -= 1) {
    const start = new Date(endHour.getTime() - index * 3_600_000);
    series.push({ start: start.toISOString(), completed: 0, failed: 0 });
  }
  const slots = new Map(series.map((bin, index) => [bin.start, index]));
  for (const row of rows) {
    const bucket = new Date(row.bucket);
    bucket.setUTCMinutes(0, 0, 0);
    const slot = slots.get(bucket.toISOString());
    if (slot === undefined) {
      continue;
    }
    const count = Number(row.count);
    const bin = series[slot];
    if (!bin) {
      continue;
    }
    if (row.status === "COMPLETED") {
      bin.completed += count;
    }
    if (row.status === "FAILED") {
      bin.failed += count;
    }
  }
  return series;
}

export async function readAnalytics(actor: PublicUser, windowHours: number, now = new Date()): Promise<AnalyticsSnapshot> {
  const prisma = getPrisma();
  const since = new Date(now.getTime() - windowHours * 3_600_000);
  const organizationWide = canListAllApiKeys(actor.role);
  const requestWhere = {
    organizationId: actor.organization.id,
    createdAt: { gte: since },
    ...(organizationWide ? {} : { userId: actor.id }),
  };
  const periodStart = usagePeriodStart(now);

  const [proxyGroups, requestGroups, latency, domainGroups, recent, usage, hourRows] = await Promise.all([
    prisma.proxy.groupBy({
      by: ["status"],
      where: { organizationId: actor.organization.id },
      _count: { _all: true },
    }),
    prisma.requestJob.groupBy({
      by: ["status"],
      where: requestWhere,
      _count: { _all: true },
    }),
    prisma.requestJob.aggregate({
      where: { ...requestWhere, latencyMs: { not: null } },
      _avg: { latencyMs: true },
    }),
    prisma.requestJob.groupBy({
      by: ["domain"],
      where: requestWhere,
      _count: { _all: true },
      _avg: { latencyMs: true },
    }),
    prisma.requestJob.findMany({
      where: requestWhere,
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        method: true,
        domain: true,
        status: true,
        httpStatus: true,
        latencyMs: true,
        createdAt: true,
      },
    }),
    prisma.usageMeter.findUnique({
      where: {
        organizationId_metric_periodStart: {
          organizationId: actor.organization.id,
          metric: "requests",
          periodStart,
        },
      },
    }),
    organizationWide
      ? prisma.$queryRaw<HourRow[]>`
          SELECT date_trunc('hour', "createdAt") AS bucket, status::text AS status, COUNT(*) AS count
          FROM "RequestJob"
          WHERE "organizationId" = ${actor.organization.id}
            AND "createdAt" >= ${since}
          GROUP BY 1, 2
        `
      : prisma.$queryRaw<HourRow[]>`
          SELECT date_trunc('hour', "createdAt") AS bucket, status::text AS status, COUNT(*) AS count
          FROM "RequestJob"
          WHERE "organizationId" = ${actor.organization.id}
            AND "userId" = ${actor.id}
            AND "createdAt" >= ${since}
          GROUP BY 1, 2
        `,
  ]);

  const proxies = {
    healthy: countStatus(proxyGroups, "HEALTHY"),
    degraded: countStatus(proxyGroups, "DEGRADED"),
    quarantined: countStatus(proxyGroups, "QUARANTINED"),
    disabled: countStatus(proxyGroups, "DISABLED"),
    total: 0,
  };
  proxies.total = proxies.healthy + proxies.degraded + proxies.quarantined + proxies.disabled;

  const completed = countStatus(requestGroups, "COMPLETED");
  const failed = countStatus(requestGroups, "FAILED");
  const queued = countStatus(requestGroups, "QUEUED");
  const running = countStatus(requestGroups, "RUNNING");
  const cancelled = countStatus(requestGroups, "CANCELLED");
  const average = latency._avg.latencyMs;

  return {
    windowHours,
    scope: organizationWide ? "organization" : "user",
    proxies,
    requests: {
      total: completed + failed + queued + running + cancelled,
      completed,
      failed,
      active: queued + running,
      avgLatencyMs: average === null ? null : Math.round(average),
    },
    usage: {
      metric: "requests",
      periodStart: periodStart.toISOString(),
      quantity: (usage?.quantity ?? 0n).toString(),
    },
    domains: domainGroups
      .map((group) => ({
        domain: group.domain,
        count: group._count._all,
        avgLatencyMs: group._avg.latencyMs === null ? null : Math.round(group._avg.latencyMs),
      }))
      .sort((left, right) => right.count - left.count || left.domain.localeCompare(right.domain))
      .slice(0, 8),
    hours: hourSeries(windowHours, hourRows, now),
    recent: recent.map((row) => ({
      id: row.id,
      method: row.method,
      domain: row.domain,
      status: row.status,
      httpStatus: row.httpStatus,
      latencyMs: row.latencyMs,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
