# Security

ProxyPilot routes authorized traffic. Owning a proxy does not grant permission to call a target.

## In scope

Permitted public-data collection, QA, monitoring, internal automation, API tests, and network tests.

## Out of scope

The codebase will not add CAPTCHA solving, authentication bypass, paywall bypass, credential stuffing, brute force, account attacks, or stealth features whose purpose is to defeat a site's access controls. `401` and `403` from a target are not automatic reasons to rotate.

## Phase 1 and 2 controls

- `redactSecrets()` runs on logger output. It removes passwords, proxy usernames, `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`, API keys, JWTs, and userinfo embedded in URLs.
- AES-256-GCM encrypts and decrypts credential strings. The key never has a default.
- API keys are stored as a SHA-256 `keyHash` and a short `prefix`. The raw `pp_live_` value is returned once at creation.
- Passwords are Argon2id hashes in `passwordHash`.
- Browser sessions are random tokens. Postgres stores `sha256(sessionSecret + token)` in `AuthSession.tokenHash`. The cookie is `HttpOnly` and `SameSite=Lax`.
- Roles are owner, admin, member, and viewer. Writes check the actor's role and the organization id on the row.
- Login failures increment a Redis counter. Ten failures for the same email and IP within 15 minutes return `429`.
- Production API errors do not include stack traces.
- Request ids are accepted only when they match `req_` plus a bounded token.

## Phase 4 controls

Health probes decrypt a proxy username and password in the worker, use them for that connection, and discard them. Check rows store status, latency, HTTP status, and a short error. Error text has URL userinfo removed. The probe target is `HEALTH_CHECK_URL` from the environment. Callers cannot choose it. A `401` or `403` from that target is a completed hop, not a reason to rotate or to bypass the target.

## Phase 6 controls

The request path accepts `http` and `https` URLs without credentials. It rejects loopback, private, link-local, metadata names, decimal IP forms, and DNS answers in those ranges. Each redirect is checked again. `401` and `403` from the target finish the job and do not rotate. Responses and attempt rows do not include proxy credentials.

Redis fixed windows limit organization, user, API key, domain, and policy `requestsPerSecond`. A policy also caps how many of its jobs may be queued or running.

## Phase 8 controls

Encoded addresses are rejected: decimal and hex words, octal or short dotted forms, and IPv6 zone identifiers. A name that resolves to any private address is rejected, including when another answer is public. Redirects are checked the same way. `SSRF_ALLOW_HOSTS` is an exact-host allowlist for an internal lab. It is empty unless the operator sets it. Credentials in a URL stay rejected even for an allowlisted host.

`GET /api/v1/audit` is limited to owners and admins and to their organization. Metadata keys that look like secrets are omitted, and userinfo is removed from stored text. Role checks keep viewers from writing inventory and members from deleting it. Another organization's rows return `404`.

## Rate limits

Phase 6 enforces Redis-backed limits for organization, user, API key, domain, and policy scopes. `REQUEST_CONCURRENCY` caps how many request jobs one worker runs at once. Policy `maxConcurrency` caps queued and running jobs for that policy.

## Cookies

The dashboard uses the `pp_session` cookie. Automation uses a bearer API key. Sticky proxy sessions, which keep one proxy for a workload, are a later phase and are not login sessions.
