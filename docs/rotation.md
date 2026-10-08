# Rotation

Selection is implemented. Policies and sticky proxy sessions are stored. The request engine enforces `maxRetries`, `maxConcurrency`, and `requestsPerSecond` when a pool sends a request.

Strategies:

- `RANDOM` — uniform choice among eligible proxies
- `ROUND_ROBIN` — cursor in Redis, not Postgres
- `LEAST_LATENCY` — lowest `avgLatencyMs` among eligible proxies
- `WEIGHTED_HEALTH` — selection weight follows `healthScore`
- `STICKY_SESSION` — reuse the proxy bound to the session until it expires or the proxy is unusable

Eligible means status allows traffic, `cooldownUntil` is null or in the past, and the proxy matches the pool. `DISABLED` proxies are never selected. Quarantined proxies are not selected for normal traffic; the recovery worker may probe them.

A `Policy` stores strategy, timeout, max retries, cooldown, session TTL, max concurrency, and requests per second. Pools point at a policy. `maxRetries` is a hard cap. The retry loop will not run without a bound.

`ProxySession` maps a user, policy, and proxy until `expiresAt`. That is separate from `AuthSession`, which is the login session. A sticky pool needs an enabled policy. The first bind, and any rebind after the proxy becomes ineligible, uses round robin among eligible proxies. Later selects reuse that proxy until the session expires. The round-robin cursor lives in Redis at `rotation:cursor:<organizationId>:<poolId>`.
