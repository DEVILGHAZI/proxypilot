import { SiteHeader } from "@/components/site-header";
import { AccountPanel } from "./account-panel";

export default function AccountPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
      <SiteHeader section="02 / access" />
      <section className="pt-8">
        <h1 className="text-[28px] font-medium leading-snug tracking-tight">Account.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
          Sessions sign the dashboard in. API keys are shown once and stored as a SHA-256 hash plus a prefix. Owners
          and admins can read the audit log.
        </p>
        <AccountPanel />
      </section>
    </main>
  );
}
