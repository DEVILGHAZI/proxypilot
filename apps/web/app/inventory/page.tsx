import { SiteHeader } from "@/components/site-header";
import { InventoryPanel } from "./inventory-panel";

export default function InventoryPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
      <SiteHeader section="03 / inventory" />
      <section className="pt-8">
        <h1 className="text-[28px] font-medium leading-snug tracking-tight">Inventory.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
          Providers, proxies, tags, and pools belong to the organization. Health checks score each proxy. Select chooses
          an eligible proxy. Send forwards a public http or https URL through that pool, retries transient failures, and
          keeps the log. Site check opens a Chrome window on this computer, loads the URL through each proxy, scrolls
          it while you watch, then writes the result below. Usernames and passwords are encrypted and are not returned.
        </p>
        <InventoryPanel />
      </section>
    </main>
  );
}
