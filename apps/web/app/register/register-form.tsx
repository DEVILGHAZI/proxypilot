"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch, errorMessage } from "@/lib/api";

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const result = await apiFetch("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        organizationName: String(form.get("organizationName") ?? ""),
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      }),
    });
    setPending(false);
    if (!result.body.success) {
      setError(errorMessage(result.body, "Could not register."));
      return;
    }
    router.push("/account");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 max-w-md space-y-4 border border-line bg-panel p-4">
      <Field label="Organization" name="organizationName" autoComplete="organization" />
      <Field label="Name" name="name" autoComplete="name" />
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <Field label="Password" name="password" type="password" autoComplete="new-password" />
      {error ? <p className="font-mono text-[11px] text-down">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating" : "Create account"}
      </Button>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  autoComplete,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{label}</span>
      <input
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        className="mt-1 w-full border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-[#3a4048]"
      />
    </label>
  );
}
