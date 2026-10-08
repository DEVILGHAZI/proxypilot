"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { ServiceState, SystemStatus } from "@/lib/status";

const rows: Array<{ key: keyof Pick<SystemStatus, "api" | "postgres" | "redis" | "worker">; label: string; detail: string }> = [
  { key: "api", label: "api", detail: "GET /health" },
  { key: "postgres", label: "postgres", detail: "SELECT 1" },
  { key: "redis", label: "redis", detail: "PING" },
  { key: "worker", label: "worker", detail: "heartbeat" },
];

function labelFor(state: ServiceState): string {
  if (state === "up") return "up";
  if (state === "down") return "down";
  return "unknown";
}

export function StatusBoard({ initial }: { initial: SystemStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);

  useEffect(() => {
    setStatus(initial);
  }, [initial]);

  useEffect(() => {
    const refresh = () => {
      void fetch("/api/status", { cache: "no-store" })
        .then((response) => response.json())
        .then((body: SystemStatus) => setStatus(body))
        .catch(() => setStatus((current) => ({ ...current, api: "down" })));
    };
    const timer = window.setInterval(refresh, 5000);
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.key === "r" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        refresh();
        router.refresh();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [router]);

  return (
    <section className="mt-10 border border-line bg-panel">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">System</p>
          <p className="mt-1 font-mono text-[11px] text-[#6d7480]">
            {status.requestId ?? "no request id"} · {status.checkedAt}
          </p>
        </div>
        <Button type="button" onClick={() => router.refresh()}>
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>
      <Separator />
      <div className="grid grid-cols-[140px_120px_1fr] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        <span>Service</span>
        <span>State</span>
        <span>Check</span>
      </div>
      <Separator />
      <ul>
        {rows.map((row) => (
          <li
            key={row.key}
            className="grid grid-cols-[140px_120px_1fr] items-center border-b border-line px-4 py-3 last:border-b-0"
          >
            <span className="font-mono text-[13px]">{row.label}</span>
            <Badge state={status[row.key]}>{labelFor(status[row.key])}</Badge>
            <span className="font-mono text-[12px] text-muted">{row.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
