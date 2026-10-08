# HTTP API

The API contract is available as OpenAPI 3.1 from `GET /openapi.json`. Success bodies use the platform envelope described below.

## Live routes

### `GET /health`

Process liveness. Does not touch Postgres or Redis.

```json
{
  "success": true,
  "requestId": "req_...",
  "data": { "status": "ok", "service": "proxypilot-api" }
}
```

### `GET /ready`

Postgres `SELECT 1` and Redis `PING`. Worker heartbeat is reported and does not fail the check.

`200` when Postgres and Redis are up. `503` with `error.code` `NOT_READY` otherwise. The `checks` object is `up`, `down`, or `unknown`.

### `GET /api/v1`

```json
{
  "success": true,
  "requestId": "req_...",
  "data": { "name": "proxypilot", "version": "0.1.0", "apiVersion": "v1" }
}
```

## Errors

```json
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "Route not found." },
  "requestId": "req_..."
}
```

`500` responses in production use `INTERNAL_ERROR` and the message `An unexpected error occurred.` Stack traces are not returned.

Send `x-request-id` as `req_` plus 8 to 80 letters, digits, or hyphens to propagate an id. Anything else is replaced.

## Auth

Phase 2 mounts session and API-key access. Success bodies use `{ success: true, requestId, data }`.

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/api/v1/auth/register` | Public. Creates an organization and an owner. Sets `pp_session`. |
| `POST` | `/api/v1/auth/login` | Public. Sets `pp_session`. |
| `POST` | `/api/v1/auth/logout` | Session cookie. Revokes that session. |
| `GET` | `/api/v1/auth/me` | Session cookie or `Authorization: Bearer pp_live_...` |
| `GET` | `/api/v1/users` | Any role in the organization. |
| `POST` | `/api/v1/users` | Owner or admin. Admins can assign member or viewer. |
| `PATCH` | `/api/v1/users/:id` | Owner or admin, not yourself. The last active owner stays an owner. |
| `GET` | `/api/v1/api-keys` | Owner and admin see the organization. Member and viewer see their own. |
| `POST` | `/api/v1/api-keys` | Member and above. The raw key is returned once. |
| `POST` | `/api/v1/api-keys/:id/revoke` | Owner and admin, or the member who owns the key. |

The session cookie is `HttpOnly` and `SameSite=Lax`. Passwords are Argon2id. API keys and session tokens are stored as hashes. Login failures are counted in Redis, 10 per email and IP in 15 minutes.

## Inventory

Phase 3 stores providers, proxies, tags, and pools. Responses never include proxy usernames, proxy passwords, or provider credentials. They report `hasUsername`, `hasPassword`, and `hasCredentials` instead.

| Method | Path | Access |
| --- | --- | --- |
| `GET`, `POST` | `/api/v1/providers` | Read: any role. Write: member and above. |
| `PATCH`, `DELETE` | `/api/v1/providers/:id` | Update: member and above. Delete: admin and above. |
| `GET`, `POST` | `/api/v1/proxies` | Same read and write split. |
| `PATCH` | `/api/v1/proxies/:id` | Member and above. Omitted credential fields stay unchanged. |
| `POST` | `/api/v1/proxies/:id/disable` and `/enable` | Member and above. |
| `DELETE` | `/api/v1/proxies/:id` | Admin and above. |
| `POST` | `/api/v1/proxies/import` | Member and above. Body `{ providerId, text }`. |
| `GET` | `/api/v1/tags` | Any role. |
| `DELETE` | `/api/v1/tags/:id` | Admin and above. |
| `GET`, `POST` | `/api/v1/pools` | Read: any role. Create: member and above. |
| `PUT` | `/api/v1/pools/:id/proxies` | Member and above. Replaces membership with `{ proxyIds }`. |

Import text accepts `host:port`, `username:password@host:port`, and CSV `host,port,username,password,protocol,country`. At most 500 lines. Existing host, port, and protocol triples are skipped.

Enabling a proxy sets its status from the health score. A quarantined score starts a cooldown. Disabling clears the cooldown and keeps the row.

## Health

The worker probes `HEALTH_CHECK_URL` through the proxy. History never includes credentials.

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Any role. Optional `proxyId` and `limit` (1–100, default 20). |
| `POST` | `/api/v1/proxies/:id/check` | Member and above. `202` when the check is queued. |

## Rotation

Select returns a proxy. Disabled, quarantined, and cooling-down proxies are skipped. Responses do not include credentials. Sending a request is a separate route.

| Method | Path | Access |
| --- | --- | --- |
| `GET`, `POST` | `/api/v1/policies` | Read: any role. Create: member and above. |
| `PATCH` | `/api/v1/policies/:id` | Member and above. |
| `DELETE` | `/api/v1/policies/:id` | Admin and above. Pools keep their own strategy. |
| `POST` | `/api/v1/pools/:id/select` | Any role in the organization. |
| `GET` | `/api/v1/sessions` | Owner and admin see the organization. Others see their own open sticky sessions. |
| `DELETE` | `/api/v1/sessions/:id` | The session owner, or an owner or admin. |

A pool can store `policyId`. When that policy is enabled, its strategy wins. Sticky selection requires a policy.

## Requests

`POST /api/v1/pools/:id/requests` queues a forward through an eligible proxy in the pool. The pool needs an enabled policy. The body is `{ url, method, body? }`. `method` defaults to `GET`. A body is kept for the worker and is not stored in Postgres. The response is `202` with the queued job. `GET /api/v1/requests` and `GET /api/v1/requests/:id` return the log and its attempts. Owner and admin see the organization. Other roles see their own jobs.

The target must be a public `http` or `https` URL. `401` and `403` complete the job. Timeouts, connection failures, `408`, `425`, `429`, and `5xx` retry until `maxRetries` extra attempts are used. Backoff starts at 200 ms and doubles, capped at 8 seconds.

`429` `RATE_LIMITED` means an organization, user, API key, domain, or policy window is full. `429` `CONCURRENCY_LIMIT` means the policy already has `maxConcurrency` queued or running jobs.

## Analytics

`GET /api/v1/analytics?hours=24` returns proxy counts for the organization and request totals for the window. `hours` is 1–168 and defaults to 24. Owners and admins see every job. Members and viewers see their own. The payload includes status counts, average latency, the top domains, one bucket per hour, the eight newest jobs, and the current month's `requests` usage meter. Recent rows include the domain, not the full URL. Credentials are not included.

## Site checks

`POST /api/v1/pools/:id/site-checks` opens the URL in Google Chrome through every proxy in the pool, up to 100 proxies. The body is `{ url, browser }`. `browser` is `CHROME`, `PHONE`, or `MIXED`. Phone layout is a phone-sized Chrome window. Mixed alternates desktop and phone windows. The response is `202`. `GET /api/v1/site-checks` and `GET /api/v1/site-checks/:id` return the run. A finished run says whether the site loaded on all proxies or on some of them. Each row includes the proxy, country when one is stored, layout, page title, and whether the page was scrolled.

## Audit

`GET /api/v1/audit?limit=50` lists recent audit events for the organization. `limit` is 1–100 and defaults to 50. Owners and admins can read it. Other roles receive `403`. Events from another organization are not included. The payload has the action, resource, actor email, and a reduced metadata object. Password-like keys are omitted.

## OpenAPI

`GET /openapi.json` is public and returns the OpenAPI 3.1 document for health, auth, users, API keys, inventory, pools, policies, rotation, requests, site checks, analytics, and audit. It describes both Bearer API-key and session-cookie authentication. The Python SDK and CLI follow this contract.
