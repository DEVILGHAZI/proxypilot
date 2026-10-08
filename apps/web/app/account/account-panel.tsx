"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch, errorMessage } from "@/lib/api";

type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  status: "ACTIVE" | "SUSPENDED" | "DISABLED";
  organization: { id: string; name: string; slug: string; plan: string };
};

type PublicApiKey = {
  id: string;
  name: string;
  prefix: string;
  userId: string;
  createdAt: string;
  revokedAt: string | null;
};

const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

type AuditEvent = {
  id: string;
  action: string;
  resource: string;
  actorEmail: string | null;
  createdAt: string;
};

export function AccountPanel() {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [keys, setKeys] = useState<PublicApiKey[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const me = await apiFetch<{ user: PublicUser }>("/api/v1/auth/me");
    if (!me.body.success) {
      setUser(null);
      setReady(true);
      return;
    }
    setUser(me.body.data.user);
    const [userList, keyList] = await Promise.all([
      apiFetch<{ users: PublicUser[] }>("/api/v1/users"),
      apiFetch<{ apiKeys: PublicApiKey[] }>("/api/v1/api-keys"),
    ]);
    if (userList.body.success) {
      setUsers(userList.body.data.users);
    }
    if (keyList.body.success) {
      setKeys(keyList.body.data.apiKeys);
    }
    if (me.body.data.user.role === "OWNER" || me.body.data.user.role === "ADMIN") {
      const audit = await apiFetch<{ events: AuditEvent[] }>("/api/v1/audit?limit=20");
      if (audit.body.success) {
        setEvents(audit.body.data.events);
      }
    }
    setReady(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function logout() {
    await apiFetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    const result = await apiFetch<{ key: PublicApiKey; secret: string }>("/api/v1/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: String(data.get("name") ?? "") }),
    });
    if (!result.body.success) {
      setError(errorMessage(result.body, "Could not create the key."));
      return;
    }
    setSecret(result.body.data.secret);
    form.reset();
    await load();
  }

  async function revoke(id: string) {
    setError(null);
    const result = await apiFetch(`/api/v1/api-keys/${id}/revoke`, { method: "POST" });
    if (!result.body.success) {
      setError(errorMessage(result.body, "Could not revoke the key."));
      return;
    }
    await load();
  }

  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    const result = await apiFetch("/api/v1/users", {
      method: "POST",
      body: JSON.stringify({
        name: String(data.get("name") ?? ""),
        email: String(data.get("email") ?? ""),
        password: String(data.get("password") ?? ""),
        role: String(data.get("role") ?? "MEMBER"),
      }),
    });
    if (!result.body.success) {
      setError(errorMessage(result.body, "Could not add the user."));
      return;
    }
    form.reset();
    await load();
  }

  async function changeRole(id: string, role: string) {
    setError(null);
    const result = await apiFetch(`/api/v1/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
    if (!result.body.success) {
      setError(errorMessage(result.body, "Could not change the role."));
      return;
    }
    await load();
  }

  if (!ready) {
    return <p className="mt-8 font-mono text-[11px] text-muted">Loading account.</p>;
  }

  if (!user) {
    return <p className="mt-8 text-sm text-muted">Sign in to manage sessions and API keys.</p>;
  }

  const canManage = user.role === "OWNER" || user.role === "ADMIN";
  const canCreate = user.role !== "VIEWER";

  return (
    <div className="mt-8 space-y-8">
      <section className="border border-line bg-panel p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Signed in</p>
            <p className="mt-2 text-sm">
              {user.name} · {user.email}
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted">
              {user.organization.name} · {user.role} · {user.organization.plan}
            </p>
          </div>
          <Button type="button" onClick={() => void logout()}>
            Log out
          </Button>
        </div>
      </section>

      <section className="border border-line">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">API keys</p>
        </div>
        {canCreate ? (
          <form onSubmit={(event) => void createKey(event)} className="flex gap-3 border-b border-line px-4 py-3">
            <input
              name="name"
              required
              placeholder="Key name"
              className="w-full border border-line bg-ink px-3 py-2 text-sm outline-none"
            />
            <Button type="submit">Create</Button>
          </form>
        ) : (
          <p className="border-b border-line px-4 py-3 text-sm text-muted">Viewers cannot create API keys.</p>
        )}
        {secret ? (
          <p className="border-b border-line px-4 py-3 font-mono text-[12px] text-ok">
            Copy this key now. It is not shown again. {secret}
          </p>
        ) : null}
        <ul>
          {keys.map((key) => (
            <li key={key.id} className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
              <div>
                <p className="text-sm">{key.name}</p>
                <p className="font-mono text-[11px] text-muted">
                  {key.prefix}… {key.revokedAt ? "revoked" : "active"}
                </p>
              </div>
              {key.revokedAt ? null : (
                <Button type="button" variant="quiet" onClick={() => void revoke(key.id)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
          {keys.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No keys yet.</li> : null}
        </ul>
      </section>

      <section className="border border-line">
        <div className="border-b border-line px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">People</p>
        </div>
        {canManage ? (
          <form onSubmit={(event) => void addUser(event)} className="grid gap-3 border-b border-line px-4 py-3 md:grid-cols-5">
            <input name="name" required placeholder="Name" className="border border-line bg-ink px-3 py-2 text-sm outline-none" />
            <input name="email" type="email" required placeholder="Email" className="border border-line bg-ink px-3 py-2 text-sm outline-none md:col-span-2" />
            <input name="password" type="password" required minLength={12} placeholder="Password" className="border border-line bg-ink px-3 py-2 text-sm outline-none" />
            <div className="flex gap-2">
              <select name="role" defaultValue="MEMBER" className="w-full border border-line bg-ink px-2 py-2 font-mono text-[11px]">
                {ROLES.filter((role) => user.role === "OWNER" || role === "MEMBER" || role === "VIEWER").map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <Button type="submit">Add</Button>
            </div>
          </form>
        ) : null}
        <ul>
          {users.map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
              <div>
                <p className="text-sm">
                  {member.name} · {member.email}
                </p>
                <p className="font-mono text-[11px] text-muted">
                  {member.role} · {member.status}
                </p>
              </div>
              {canManage && member.id !== user.id ? (
                <select
                  value={member.role}
                  onChange={(event) => void changeRole(member.id, event.target.value)}
                  className="border border-line bg-ink px-2 py-2 font-mono text-[11px]"
                >
                  {ROLES.filter((role) => user.role === "OWNER" || role === "MEMBER" || role === "VIEWER").map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {user.role === "OWNER" || user.role === "ADMIN" ? (
        <section className="border border-line">
          <header className="border-b border-line px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Audit
          </header>
          <ul>
            {events.map((event) => (
              <li key={event.id} className="border-b border-line px-4 py-3 last:border-b-0">
                <p className="text-sm">
                  {event.action} · {event.resource}
                </p>
                <p className="font-mono text-[11px] text-muted">
                  {event.actorEmail ?? "system"} · {event.createdAt}
                </p>
              </li>
            ))}
            {events.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No audit events yet.</li> : null}
          </ul>
        </section>
      ) : null}
      {error ? <p className="font-mono text-[11px] text-down">{error}</p> : null}
    </div>
  );
}
