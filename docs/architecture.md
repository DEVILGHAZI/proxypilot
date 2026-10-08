# Architecture

ProxyPilot has three planes. Phase 1 runs the processes and the schema. Behavior for rotation and request execution is specified here and implemented in later phases.

## Planes

**Control plane.** Organizations, users, sessions, API keys, providers, pools, policies, and audit logs. Every tenant-owned row carries `organizationId`.

**Data plane.** Proxy selection, sticky sessions, retries, rate limits, and outbound HTTP. Phase 6 runs that path: authenticate, authorize, validate the URL, reject non-public targets, apply rate limits, select a healthy proxy, execute, classify the result, and retry only transient failures up to the policy cap. Phase 8 rejects encoded local addresses and DNS answers in private ranges. An exact-host allowlist exists and stays empty by default.

**Observability plane.** Health checks, request history, and metrics. Phase 1 exposes process readiness and a worker heartbeat in Redis. Postgres remains the system of record. Redis holds queues, rate-limit counters, locks, rotation cursors, and the heartbeat. It is not the only copy of durable data.

```text
Next.js  -->  Fastify API  -->  PostgreSQL
                  |    \
                  |     Redis  -->  BullMQ worker --> proxy --> target
```

## Processes

| Process | Port | Role in Phase 1 |
| --- | --- | --- |
| web | 3000 | Status page, register, login, account, dashboard, and inventory. The browser calls `/api/v1` on the web origin, which rewrites to the API. |
| api | 4000 | Liveness, readiness, version, sessions, users, API keys, inventory, health history, and request admission. |
| worker | none | Heartbeat, proxy health checks, quarantine recovery, request execution, retries, request cleanup, and Chrome site checks. |
| postgres | 5432 | Durable store. |
| redis | 6379 | Queue and heartbeat. |

`docker compose up -d` starts Postgres and Redis. The `app` profile also builds api, worker, and web so host `pnpm dev` does not fight container ports.

## Queues

`health-check`, `request`, `retry`, `proxy-recovery`, `analytics`, `cleanup`, `site-check`, and `system`.

Concurrency comes from `HEALTH_CHECK_CONCURRENCY` and `REQUEST_CONCURRENCY`. Recovery is capped at 10. Analytics is 2. Cleanup is 1. System is 2. Nothing is unlimited.

`system` / `ping` writes `worker:heartbeat` with a 30 second TTL. A 10 second interval writes the same key while the process is up. The worker consumes `health-check`, `proxy-recovery`, `request`, `retry`, `cleanup`, and `site-check`. Site checks open the target in Chrome through each proxy. The analytics queue stays available for later rollups. The dashboard reads request jobs, proxy status, and the monthly usage meter from Postgres.

## Data model

The initial migration creates organizations, users, auth sessions, API keys (hash and prefix only), providers, proxies, tags, pools, policies, sticky proxy sessions, request jobs, attempts, health checks, audit logs, and usage meters. Proxy health scores are constrained to 0..100. Proxy credential columns are ciphertext fields. Encryption helpers exist; nothing writes credentials until provider management.

Plans on `Organization` are `FREE`, `STARTER`, `PRO`, `BUSINESS`, and `ENTERPRISE`. `UsageMeter` stores counters. There is no payment integration.

## Failure shape

API failures use:

```json
{
  "success": false,
  "error": { "code": "NOT_READY", "message": "One or more dependencies are unavailable." },
  "requestId": "req_..."
}
```

Production responses omit stack traces and replace 500 messages with a fixed sentence.

## Phase map

1. Foundation. This repository state.
2. Register, login, logout, sessions, RBAC, hashed API keys. Implemented.
3. Providers, proxies, import, encryption at the write path, pools, tags. Implemented.
4. Health checks, scoring, cooldown, recovery. Implemented.
5. Rotation strategies and sticky sessions. Implemented. Selection does not forward the request.
6. Request engine, retries, backoff, rate limits, request logs. Implemented. Forwarding uses an eligible proxy. `401` and `403` are finished responses.
7. Dashboard. Implemented. `GET /api/v1/analytics` summarizes proxy health and request outcomes. Owners and admins see the organization. Other roles see their own jobs.
8. SSRF encoded-address checks, internal allowlist, authorization tests, and the audit read API. Implemented.
9. OpenAPI 3.1 document, Python SDK, and JSON-output CLI. Implemented.
10. Production images hardening, CI, backups, scaling notes beyond Compose.
