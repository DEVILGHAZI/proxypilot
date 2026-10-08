"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch, errorMessage } from "@/lib/api";

type Analytics = {
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

function formatHour(value: string): string {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function DashboardPanel() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  const load = useCallback(async () => {
    const result = await apiFetch<{ analytics: Analytics }>("/api/v1/analytics?hours=24");
    if (!result.body.success) {
      setSignedOut(result.status === 401);
      setError(errorMessage(result.body, "Could not load the dashboard."));
      setReady(true);
      return;
    }
    setSignedOut(false);
    setError(null);
    setAnalytics(result.body.data.analytics);
    setReady(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) {
    return <p className="mt-8 font-mono text-[11px] text-muted">Loading dashboard.</p>;
  }
  if (signedOut || !analytics) {
    return <p className="mt-8 text-sm text-muted">Sign in to see proxy health and request outcomes.</p>;
  }

  const peak = Math.max(1, ...analytics.hours.map((hour) => hour.completed + hour.failed));
  const cards = [
    ["Healthy proxies", String(analytics.proxies.healthy)],
    ["Requests", String(analytics.requests.total)],
    ["Completed", String(analytics.requests.completed)],
    ["Failed", String(analytics.requests.failed)],
    ["Avg latency", analytics.requests.avgLatencyMs === null ? "—" : `${analytics.requests.avgLatencyMs} ms`],
    ["This month", analytics.usage.quantity],
  ];

  return (
    <div className="mt-8 space-y-8">
      {error ? <p className="font-mono text-[11px] text-down">{error}</p> : null}
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Last {analytics.windowHours} hours · {analytics.scope === "organization" ? "organization" : "your requests"}
        </p>
        <Button type="button" variant="quiet" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      <div className="grid border border-line sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([label, value]) => (
          <div key={label} className="border-b border-line px-4 py-4 sm:[&:nth-child(odd)]:border-r lg:border-r lg:[&:nth-child(3n)]:border-r-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{label}</p>
            <p className="mt-2 text-2xl tracking-tight">{value}</p>
          </div>
        ))}
      </div>
      <section className="border border-line">
        <header className="border-b border-line px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Requests by hour
        </header>
        <div className="flex h-28 items-end gap-1 px-4 py-4">
          {analytics.hours.map((hour) => {
            const total = hour.completed + hour.failed;
            const height = total === 0 ? 2 : Math.max(4, Math.round((total / peak) * 72));
            const failedHeight = total === 0 ? 0 : Math.round((hour.failed / total) * height);
            return (
              <div key={hour.start} className="flex min-w-0 flex-1 flex-col items-center justify-end" title={`${formatHour(hour.start)} · ${hour.completed} completed · ${hour.failed} failed`}>
                <div className="flex w-full max-w-3 flex-col justify-end" style={{ height }}>
                  <div className="bg-[#6a3a32]" style={{ height: failedHeight }} />
                  <div className="bg-[#3a3f46]" style={{ height: height - failedHeight }} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="border-t border-line px-4 py-3 font-mono text-[11px] text-muted">
          {analytics.proxies.healthy} healthy · {analytics.proxies.degraded} degraded · {analytics.proxies.quarantined} quarantined · {analytics.proxies.disabled} disabled · {analytics.requests.active} active
        </p>
      </section>
      <div className="grid gap-8 lg:grid-cols-2">
        <section className="border border-line">
          <header className="border-b border-line px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Domains
          </header>
          <ul>
            {analytics.domains.map((domain) => (
              <li key={domain.domain} className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
                <p className="text-sm">{domain.domain}</p>
                <p className="font-mono text-[11px] text-muted">
                  {domain.count}
                  {domain.avgLatencyMs === null ? "" : ` · ${domain.avgLatencyMs} ms`}
                </p>
              </li>
            ))}
            {analytics.domains.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No requests in this window.</li> : null}
          </ul>
        </section>
        <section className="border border-line">
          <header className="border-b border-line px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Recent
          </header>
          <ul>
            {analytics.recent.map((entry) => (
              <li key={entry.id} className="border-b border-line px-4 py-3 last:border-b-0">
                <p className="text-sm">
                  {entry.method} {entry.domain}
                </p>
                <p className="font-mono text-[11px] text-muted">
                  {entry.status}
                  {entry.httpStatus === null ? "" : ` · ${entry.httpStatus}`}
                  {entry.latencyMs === null ? "" : ` · ${entry.latencyMs} ms`}
                </p>
              </li>
            ))}
            {analytics.recent.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No requests in this window.</li> : null}
          </ul>
        </section>
      </div>
    </div>
  );
}
