"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch, errorMessage } from "@/lib/api";

type Provider = {
  id: string;
  name: string;
  type: string;
  protocol: string;
  status: string;
  hasCredentials: boolean;
  proxyCount: number;
};

type ProxyRow = {
  id: string;
  providerId: string;
  host: string;
  port: number;
  protocol: string;
  status: string;
  healthScore: number;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number | null;
  lastCheckedAt: string | null;
  cooldownUntil: string | null;
  country: string | null;
  hasUsername: boolean;
  hasPassword: boolean;
  tags: string[];
};

type HealthCheck = {
  id: string;
  proxyId: string;
  status: "SUCCESS" | "FAILED";
  latencyMs: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  checkedAt: string;
};

type Pool = {
  id: string;
  name: string;
  strategy: string;
  status: string;
  policyId: string | null;
  proxyIds: string[];
};

type Policy = {
  id: string;
  name: string;
  strategy: string;
  timeoutMs: number;
  maxRetries: number;
  maxConcurrency: number;
  requestsPerSecond: number;
  sessionTtlSeconds: number;
  enabled: boolean;
  poolCount: number;
};

type ProxySession = {
  id: string;
  policyId: string;
  host: string;
  port: number;
  expiresAt: string;
};

type Selection = {
  strategy: string;
  proxy: { host: string; port: number; status: string; healthScore: number };
  session: { id: string; expiresAt: string } | null;
};

type RequestLog = {
  id: string;
  url: string;
  method: string;
  status: string;
  httpStatus: number | null;
  attempts: number;
  latencyMs: number | null;
  errorCode: string | null;
};

type SiteCheckRun = {
  id: string;
  url: string;
  browser: string;
  status: string;
  summary: string;
  checks: Array<{
    id: string;
    host: string;
    port: number;
    country: string | null;
    layout: string;
    status: string;
    title: string | null;
    scrolled: boolean;
    latencyMs: number | null;
    errorCode: string | null;
  }>;
};

const inputClass = "w-full border border-line bg-ink px-3 py-2 text-sm outline-none";

export function InventoryPanel() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [proxies, setProxies] = useState<ProxyRow[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [sessions, setSessions] = useState<ProxySession[]>([]);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [requests, setRequests] = useState<RequestLog[]>([]);
  const [siteChecks, setSiteChecks] = useState<SiteCheckRun[]>([]);
  const [sending, setSending] = useState(false);
  const [checkingSite, setCheckingSite] = useState(false);
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  const load = useCallback(async () => {
    const [providerList, proxyList, poolList, healthList, policyList, sessionList, requestList, siteCheckList] = await Promise.all([
      apiFetch<{ providers: Provider[] }>("/api/v1/providers"),
      apiFetch<{ proxies: ProxyRow[] }>("/api/v1/proxies"),
      apiFetch<{ pools: Pool[] }>("/api/v1/pools"),
      apiFetch<{ checks: HealthCheck[] }>("/api/v1/health?limit=100"),
      apiFetch<{ policies: Policy[] }>("/api/v1/policies"),
      apiFetch<{ sessions: ProxySession[] }>("/api/v1/sessions"),
      apiFetch<{ requests: RequestLog[] }>("/api/v1/requests?limit=20"),
      apiFetch<{ runs: SiteCheckRun[] }>("/api/v1/site-checks?limit=5"),
    ]);
    if (!providerList.body.success) {
      setSignedOut(providerList.status === 401);
      setError(errorMessage(providerList.body, "Could not load inventory."));
      setReady(true);
      return;
    }
    setSignedOut(false);
    setProviders(providerList.body.data.providers);
    if (proxyList.body.success) {
      setProxies(proxyList.body.data.proxies);
    }
    if (poolList.body.success) {
      setPools(poolList.body.data.pools);
    }
    if (healthList.body.success) {
      setChecks(healthList.body.data.checks);
    }
    if (policyList.body.success) {
      setPolicies(policyList.body.data.policies);
    }
    if (sessionList.body.success) {
      setSessions(sessionList.body.data.sessions);
    }
    if (requestList.body.success) {
      setRequests(requestList.body.data.requests);
    }
    if (siteCheckList.body.success) {
      setSiteChecks(siteCheckList.body.data.runs);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    const result = await apiFetch("/api/v1/providers", {
      method: "POST",
      body: JSON.stringify({
        name: String(data.get("name") ?? ""),
        type: String(data.get("type") ?? "CUSTOM"),
        protocol: String(data.get("protocol") ?? "HTTP"),
        username: String(data.get("username") ?? "") || undefined,
        password: String(data.get("password") ?? "") || undefined,
      }),
    });
    if (!result.body.success) {
      setError(errorMessage(result.body, "Could not add the provider."));
      return;
    }
    form.reset();
    setNotice("Provider saved. Credentials are encrypted.");
    await load();
  }

  async function addProxy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const tags = String(data.get("tags") ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    setError(null);
    const result = await apiFetch("/api/v1/proxies", {
      method: "POST",
      body: JSON.stringify({
        providerId: String(data.get("providerId") ?? ""),
        host: String(data.get("host") ?? ""),
        port: Number(data.get("port") ?? "0"),
        username: String(data.get("username") ?? "") || undefined,
        password: String(data.get("password") ?? "") || undefined,
        country: String(data.get("country") ?? "") || undefined,
        tagNames: tags,
      }),
    });
    if (!result.body.success) {
      setError(errorMessage(result.body, "Could not add the proxy."));
      return;
    }
    form.reset();
    setNotice("Proxy saved. The password is not shown again.");
    await load();
  }

  async function importLines(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    const result = await apiFetch<{ created: number; skipped: number; errors: { line: number; message: string }[] }>(
      "/api/v1/proxies/import",
      {
        method: "POST",
        body: JSON.stringify({
          providerId: String(data.get("providerId") ?? ""),
          text: String(data.get("text") ?? ""),
        }),
      },
    );
    if (!result.body.success) {
      setError(errorMessage(result.body, "Could not import proxies."));
      return;
    }
    const summary = result.body.data;
    form.reset();
    setNotice(`Imported ${summary.created}, skipped ${summary.skipped}, errors ${summary.errors.length}.`);
    await load();
  }

  async function addPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    const result = await apiFetch("/api/v1/policies", {
      method: "POST",
      body: JSON.stringify({
        name: String(data.get("name") ?? ""),
        strategy: String(data.get("strategy") ?? "ROUND_ROBIN"),
        timeoutMs: 30_000,
        maxRetries: 3,
        cooldownSeconds: 60,
        sessionTtlSeconds: 600,
        maxConcurrency: 10,
        requestsPerSecond: 10,
      }),
    });
    if (!result.body.success) {
      setError(errorMessage(result.body, "Could not add the policy."));
      return;
    }
    form.reset();
    setNotice("Policy saved. Retries, concurrency, and requests per second apply when you send.");
    await load();
  }

  async function selectPool(pool: Pool) {
    setError(null);
    setSelectingId(pool.id);
    const result = await apiFetch<{ selection: Selection }>(`/api/v1/pools/${pool.id}/select`, { method: "POST" });
    setSelectingId(null);
    if (!result.body.success) {
      setError(errorMessage(result.body, "Could not select a proxy."));
      return;
    }
    const selection = result.body.data.selection;
    setNotice(`Selected ${selection.proxy.host}:${selection.proxy.port} · ${selection.strategy} · score ${selection.proxy.healthScore}.`);
    await load();
  }

  async function sendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSending(true);
    setError(null);
    const result = await apiFetch<{ request: RequestLog }>(`/api/v1/pools/${String(data.get("poolId") ?? "")}/requests`, {
      method: "POST",
      body: JSON.stringify({
        url: String(data.get("url") ?? ""),
        method: String(data.get("method") ?? "GET"),
      }),
    });
    if (!result.body.success) {
      setSending(false);
      setError(errorMessage(result.body, "Could not send the request."));
      return;
    }
    const requestId = result.body.data.request.id;
    let finished: RequestLog | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const current = await apiFetch<{ request: RequestLog }>(`/api/v1/requests/${requestId}`);
      if (current.body.success) {
        const row = current.body.data.request;
        if (row.status === "COMPLETED" || row.status === "FAILED" || row.status === "CANCELLED") {
          finished = row;
          break;
        }
      }
    }
    setSending(false);
    if (finished) {
      const http = finished.httpStatus === null ? (finished.errorCode ?? finished.status) : String(finished.httpStatus);
      setNotice(`Request ${finished.status} · ${http} · ${finished.attempts} attempt${finished.attempts === 1 ? "" : "s"}.`);
    } else {
      setNotice("Request is still running.");
    }
    await load();
  }

  async function checkSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setCheckingSite(true);
    setError(null);
    const result = await apiFetch<{ run: SiteCheckRun }>(`/api/v1/pools/${String(data.get("poolId") ?? "")}/site-checks`, {
      method: "POST",
      body: JSON.stringify({
        url: String(data.get("url") ?? ""),
        browser: String(data.get("browser") ?? "CHROME"),
      }),
    });
    if (!result.body.success) {
      setCheckingSite(false);
      setError(errorMessage(result.body, "Could not start the site check."));
      return;
    }
    const runId = result.body.data.run.id;
    let finished: SiteCheckRun | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const current = await apiFetch<{ run: SiteCheckRun }>(`/api/v1/site-checks/${runId}`);
      if (current.body.success) {
        const run = current.body.data.run;
        if (run.status === "PASSED" || run.status === "FAILED") {
          finished = run;
          break;
        }
      }
    }
    setCheckingSite(false);
    setNotice(finished?.summary ?? "Site check is still running.");
    await load();
  }

  async function addPool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    const result = await apiFetch<{ pool: Pool }>("/api/v1/pools", {
      method: "POST",
      body: JSON.stringify({
        name: String(data.get("name") ?? ""),
        strategy: String(data.get("strategy") ?? "ROUND_ROBIN"),
        policyId: String(data.get("policyId") ?? "") || undefined,
      }),
    });
    if (!result.body.success) {
      setError(errorMessage(result.body, "Could not add the pool."));
      return;
    }
    const selected = proxies.filter((proxy) => data.get(`proxy-${proxy.id}`) === "on").map((proxy) => proxy.id);
    if (selected.length > 0) {
      await apiFetch(`/api/v1/pools/${result.body.data.pool.id}/proxies`, {
        method: "PUT",
        body: JSON.stringify({ proxyIds: selected }),
      });
    }
    form.reset();
    await load();
  }

  function latestCheck(proxyId: string): HealthCheck | undefined {
    return checks.find((check) => check.proxyId === proxyId);
  }

  async function checkProxy(proxy: ProxyRow) {
    setError(null);
    setCheckingId(proxy.id);
    const previous = latestCheck(proxy.id)?.checkedAt ?? "";
    const result = await apiFetch(`/api/v1/proxies/${proxy.id}/check`, { method: "POST" });
    if (!result.body.success) {
      setCheckingId(null);
      setError(errorMessage(result.body, "Could not queue a health check."));
      return;
    }
    setNotice("Health check queued.");
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const history = await apiFetch<{ checks: HealthCheck[] }>(`/api/v1/health?proxyId=${proxy.id}&limit=1`);
      if (!history.body.success) {
        continue;
      }
      const latest = history.body.data.checks[0];
      if (latest && latest.checkedAt !== previous) {
        setNotice(
          latest.status === "SUCCESS"
            ? `Check succeeded${latest.latencyMs !== null ? ` in ${latest.latencyMs} ms` : ""}.`
            : `Check failed${latest.errorCode ? `: ${latest.errorCode}` : ""}.`,
        );
        break;
      }
    }
    setCheckingId(null);
    await load();
  }

  async function toggleProxy(proxy: ProxyRow) {
    setError(null);
    const path = proxy.status === "DISABLED" ? "enable" : "disable";
    const result = await apiFetch(`/api/v1/proxies/${proxy.id}/${path}`, { method: "POST" });
    if (!result.body.success) {
      setError(errorMessage(result.body, "Could not update the proxy."));
      return;
    }
    await load();
  }

  if (!ready) {
    return <p className="mt-8 font-mono text-[11px] text-muted">Loading inventory.</p>;
  }
  if (signedOut) {
    return <p className="mt-8 text-sm text-muted">Sign in to manage providers and proxies.</p>;
  }

  return (
    <div className="mt-8 space-y-8">
      {error ? <p className="font-mono text-[11px] text-down">{error}</p> : null}
      {notice ? <p className="font-mono text-[11px] text-ok">{notice}</p> : null}

      <section className="border border-line">
        <header className="border-b border-line px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Providers
        </header>
        <form onSubmit={(event) => void addProvider(event)} className="grid gap-3 border-b border-line px-4 py-3 md:grid-cols-6">
          <input name="name" required placeholder="Name" className={inputClass} />
          <select name="type" defaultValue="DATACENTER" className={inputClass}>
            {["DATACENTER", "RESIDENTIAL", "ISP", "MOBILE", "CUSTOM"].map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
          <select name="protocol" defaultValue="HTTP" className={inputClass}>
            {["HTTP", "HTTPS", "SOCKS5"].map((protocol) => (
              <option key={protocol}>{protocol}</option>
            ))}
          </select>
          <input name="username" placeholder="Username" autoComplete="off" className={inputClass} />
          <input name="password" type="password" placeholder="Password" autoComplete="new-password" className={inputClass} />
          <Button type="submit">Add</Button>
        </form>
        <ul>
          {providers.map((provider) => (
            <li key={provider.id} className="border-b border-line px-4 py-3 last:border-b-0">
              <p className="text-sm">{provider.name}</p>
              <p className="font-mono text-[11px] text-muted">
                {provider.type} · {provider.protocol} · {provider.status} · {provider.proxyCount} proxies ·{" "}
                {provider.hasCredentials ? "credentials stored" : "no credentials"}
              </p>
            </li>
          ))}
          {providers.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No providers yet.</li> : null}
        </ul>
      </section>

      <section className="border border-line">
        <header className="border-b border-line px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Proxies
        </header>
        <form onSubmit={(event) => void addProxy(event)} className="grid gap-3 border-b border-line px-4 py-3 md:grid-cols-4">
          <select name="providerId" required className={inputClass} defaultValue="">
            <option value="" disabled>
              Provider
            </option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
          <input name="host" required placeholder="Host" className={inputClass} />
          <input name="port" required type="number" min={1} max={65535} placeholder="Port" className={inputClass} />
          <input name="country" placeholder="Country" className={inputClass} />
          <input name="username" placeholder="Username" autoComplete="off" className={inputClass} />
          <input name="password" type="password" placeholder="Password" autoComplete="new-password" className={inputClass} />
          <input name="tags" placeholder="Tags, comma separated" className={inputClass} />
          <Button type="submit">Add proxy</Button>
        </form>
        <ul>
          {proxies.map((proxy) => (
            <li key={proxy.id} className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
              <div>
                <p className="font-mono text-sm">
                  {proxy.host}:{proxy.port}
                </p>
                <p className="font-mono text-[11px] text-muted">
                  {proxy.protocol} · {proxy.status} · score {proxy.healthScore}
                  {proxy.avgLatencyMs !== null ? ` · ${Math.round(proxy.avgLatencyMs)} ms` : ""}
                  {proxy.country ? ` · ${proxy.country}` : ""} · {proxy.hasPassword ? "password stored" : "no password"}
                  {proxy.tags.length > 0 ? ` · ${proxy.tags.join(", ")}` : ""}
                </p>
                <p className="font-mono text-[11px] text-muted">
                  {proxy.successCount} ok · {proxy.failureCount} failed
                  {proxy.cooldownUntil ? ` · cooldown until ${proxy.cooldownUntil.slice(0, 16).replace("T", " ")} UTC` : ""}
                  {latestCheck(proxy.id)?.errorCode ? ` · last ${latestCheck(proxy.id)?.errorCode}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="quiet" disabled={checkingId === proxy.id} onClick={() => void checkProxy(proxy)}>
                  {checkingId === proxy.id ? "Checking" : "Check"}
                </Button>
                <Button type="button" variant="quiet" onClick={() => void toggleProxy(proxy)}>
                  {proxy.status === "DISABLED" ? "Enable" : "Disable"}
                </Button>
              </div>
            </li>
          ))}
          {proxies.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No proxies yet.</li> : null}
        </ul>
      </section>

      <section className="border border-line">
        <header className="border-b border-line px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Import
        </header>
        <form onSubmit={(event) => void importLines(event)} className="space-y-3 px-4 py-3">
          <select name="providerId" required className={inputClass} defaultValue="">
            <option value="" disabled>
              Provider
            </option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
          <textarea
            name="text"
            required
            rows={5}
            placeholder={"host:port\nusername:password@host:port\nhost,port,username,password,protocol,country"}
            className={`${inputClass} font-mono text-[12px]`}
          />
          <Button type="submit">Import</Button>
        </form>
      </section>

      <section className="border border-line">
        <header className="border-b border-line px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Policies
        </header>
        <form onSubmit={(event) => void addPolicy(event)} className="grid gap-3 border-b border-line px-4 py-3 md:grid-cols-3">
          <input name="name" required placeholder="Policy name" className={inputClass} />
          <select name="strategy" defaultValue="ROUND_ROBIN" className={inputClass}>
            {["ROUND_ROBIN", "RANDOM", "LEAST_LATENCY", "WEIGHTED_HEALTH", "STICKY_SESSION"].map((strategy) => (
              <option key={strategy}>{strategy}</option>
            ))}
          </select>
          <Button type="submit">Add policy</Button>
        </form>
        <ul>
          {policies.map((policy) => (
            <li key={policy.id} className="border-b border-line px-4 py-3 last:border-b-0">
              <p className="text-sm">{policy.name}</p>
              <p className="font-mono text-[11px] text-muted">
                {policy.strategy} · {policy.enabled ? "enabled" : "disabled"} · {policy.maxRetries} retries · {policy.requestsPerSecond}/s · {policy.maxConcurrency} at once · {policy.poolCount} pools
              </p>
            </li>
          ))}
          {policies.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No policies yet.</li> : null}
        </ul>
      </section>

      <section className="border border-line">
        <header className="border-b border-line px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Pools
        </header>
        <form onSubmit={(event) => void addPool(event)} className="space-y-3 border-b border-line px-4 py-3">
          <div className="grid gap-3 md:grid-cols-4">
            <input name="name" required placeholder="Pool name" className={inputClass} />
            <select name="strategy" defaultValue="ROUND_ROBIN" className={inputClass}>
              {["ROUND_ROBIN", "RANDOM", "LEAST_LATENCY", "WEIGHTED_HEALTH", "STICKY_SESSION"].map((strategy) => (
                <option key={strategy}>{strategy}</option>
              ))}
            </select>
            <select name="policyId" className={inputClass} defaultValue="">
              <option value="">No policy</option>
              {policies.map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.name}
                </option>
              ))}
            </select>
            <Button type="submit">Create pool</Button>
          </div>
          <div className="flex flex-wrap gap-3">
            {proxies.map((proxy) => (
              <label key={proxy.id} className="font-mono text-[11px] text-muted">
                <input name={`proxy-${proxy.id}`} type="checkbox" className="mr-2" />
                {proxy.host}:{proxy.port}
              </label>
            ))}
          </div>
        </form>
        <ul>
          {pools.map((pool) => (
            <li key={pool.id} className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
              <div>
                <p className="text-sm">{pool.name}</p>
                <p className="font-mono text-[11px] text-muted">
                  {pool.strategy} · {pool.status} · {pool.proxyIds.length} proxies
                  {pool.policyId ? " · policy attached" : ""}
                </p>
              </div>
              <Button type="button" variant="quiet" disabled={selectingId === pool.id} onClick={() => void selectPool(pool)}>
                {selectingId === pool.id ? "Selecting" : "Select"}
              </Button>
            </li>
          ))}
          {pools.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No pools yet.</li> : null}
        </ul>
        {sessions.length > 0 ? (
          <p className="border-t border-line px-4 py-3 font-mono text-[11px] text-muted">
            Sticky sessions: {sessions.map((session) => `${session.host}:${session.port}`).join(", ")}
          </p>
        ) : null}
      </section>

      <section className="border border-line">
        <header className="border-b border-line px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Requests
        </header>
        <form onSubmit={(event) => void sendRequest(event)} className="grid gap-3 border-b border-line px-4 py-3 md:grid-cols-4">
          <select name="poolId" required className={inputClass} defaultValue="">
            <option value="" disabled>
              Pool
            </option>
            {pools.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.name}
              </option>
            ))}
          </select>
          <select name="method" defaultValue="GET" className={inputClass}>
            {["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
          <input name="url" required defaultValue="https://example.com/" className={inputClass} />
          <Button type="submit" disabled={sending}>
            {sending ? "Sending" : "Send"}
          </Button>
        </form>
        <ul>
          {requests.map((entry) => (
            <li key={entry.id} className="border-b border-line px-4 py-3 last:border-b-0">
              <p className="text-sm">
                {entry.method} {entry.url}
              </p>
              <p className="font-mono text-[11px] text-muted">
                {entry.status}
                {entry.httpStatus === null ? "" : ` · ${entry.httpStatus}`}
                {entry.errorCode ? ` · ${entry.errorCode}` : ""} · {entry.attempts} attempt{entry.attempts === 1 ? "" : "s"}
                {entry.latencyMs === null ? "" : ` · ${entry.latencyMs} ms`}
              </p>
            </li>
          ))}
          {requests.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No requests yet.</li> : null}
        </ul>
      </section>

      <section className="border border-line">
        <header className="border-b border-line px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Site check
        </header>
        <p className="border-b border-line px-4 py-3 text-sm text-muted">
          A Chrome window opens on this computer for every proxy. You can watch the page load and scroll. The window
          closes, and the result is written below. Phone layout uses a phone-sized window. Mixed alternates the two.
        </p>
        <form onSubmit={(event) => void checkSite(event)} className="grid gap-3 border-b border-line px-4 py-3 md:grid-cols-4">
          <select name="poolId" required className={inputClass} defaultValue="">
            <option value="" disabled>
              Pool
            </option>
            {pools.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.name}
              </option>
            ))}
          </select>
          <select name="browser" defaultValue="CHROME" className={inputClass}>
            <option value="CHROME">Chrome</option>
            <option value="PHONE">Phone layout</option>
            <option value="MIXED">Mixed</option>
          </select>
          <input name="url" required defaultValue="https://startyoga360.com/" className={inputClass} />
          <Button type="submit" disabled={checkingSite}>
            {checkingSite ? "Checking" : "Check site"}
          </Button>
        </form>
        <ul>
          {siteChecks.map((run) => (
            <li key={run.id} className="border-b border-line px-4 py-3 last:border-b-0">
              <p className="text-sm">{run.url}</p>
              <p className="font-mono text-[11px] text-muted">
                {run.browser} · {run.status} · {run.summary}
              </p>
              <ul className="mt-2">
                {run.checks.map((check) => (
                  <li key={check.id} className="font-mono text-[11px] text-muted">
                    {check.host}:{check.port}
                    {check.country ? ` · ${check.country}` : ""} · {check.layout} · {check.status}
                    {check.title ? ` · ${check.title}` : ""}
                    {check.scrolled ? " · scrolled" : ""}
                    {check.latencyMs === null ? "" : ` · ${check.latencyMs} ms`}
                    {check.errorCode ? ` · ${check.errorCode}` : ""}
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {siteChecks.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No site checks yet.</li> : null}
        </ul>
      </section>
    </div>
  );
}
