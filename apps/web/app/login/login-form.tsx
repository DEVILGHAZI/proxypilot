"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch, errorMessage } from "@/lib/api";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const result = await apiFetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      }),
    });
    setPending(false);
    if (!result.body.success) {
      setError(errorMessage(result.body, "Could not sign in."));
      return;
    }
    router.push("/account");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 max-w-md space-y-4 border border-line bg-panel p-4">
      <label className="block">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1 w-full border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-[#3a4048]"
        />
      </label>
      <label className="block">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mt-1 w-full border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-[#3a4048]"
        />
      </label>
      {error ? <p className="font-mono text-[11px] text-down">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in" : "Sign in"}
      </Button>
    </form>
  );
}
