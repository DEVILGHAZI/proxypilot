import { SiteHeader } from "@/components/site-header";
import { DashboardPanel } from "./dashboard-panel";

export default function DashboardPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
      <SiteHeader section="04 / dashboard" />
      <section className="pt-8">
        <h1 className="text-[28px] font-medium leading-snug tracking-tight">Dashboard.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
          Proxy health is for the organization. Request totals follow your role: owners and admins see every job, and
          other roles see their own. Counts come from stored jobs, not from the proxy credentials.
        </p>
        <DashboardPanel />
      </section>
    </main>
  );
}
