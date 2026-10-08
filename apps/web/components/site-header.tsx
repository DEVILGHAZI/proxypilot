import Link from "next/link";

export function SiteHeader({ section }: { section: string }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-line pb-4">
      <div className="flex items-baseline gap-3">
        <Link href="/" className="font-mono text-[13px] tracking-[0.18em]">
          PROXYPILOT
        </Link>
        <span className="font-mono text-[11px] text-muted">{section}</span>
      </div>
      <nav className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        <Link href="/" className="hover:text-[#e7e8ea]">
          Status
        </Link>
        <Link href="/login" className="hover:text-[#e7e8ea]">
          Sign in
        </Link>
        <Link href="/register" className="hover:text-[#e7e8ea]">
          Register
        </Link>
        <Link href="/account" className="hover:text-[#e7e8ea]">
          Account
        </Link>
        <Link href="/dashboard" className="hover:text-[#e7e8ea]">
          Dashboard
        </Link>
        <Link href="/inventory" className="hover:text-[#e7e8ea]">
          Inventory
        </Link>
      </nav>
    </header>
  );
}
