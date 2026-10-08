import { SiteHeader } from "@/components/site-header";
import { StatusBoard } from "./status-board";
import { loadSystemStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const status = await loadSystemStatus();

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
      <SiteHeader section="02 / access" />
      <section className="pt-8">
        <h1 className="max-w-2xl text-[28px] font-medium leading-snug tracking-tight">
          Intelligent Proxy Infrastructure for Reliable Web Requests.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
          Control plane, data plane, and observability for permitted HTTP traffic. Register an organization,
          then use a session cookie or a hashed API key. Select chooses a proxy. Send forwards the request through one.
          The dashboard summarizes health and outcomes.
        </p>
      </section>
      <StatusBoard initial={status} />
      <p className="mt-4 font-mono text-[11px] text-[#6d7480]">Press r to refresh. Status polls every 5 seconds.</p>
    </main>
  );
}
