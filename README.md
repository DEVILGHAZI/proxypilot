# ProxyPilot

Intelligent Proxy Infrastructure for Reliable Web Requests.

ProxyPilot is a control plane for authorized HTTP workloads: proxy inventory, health, rotation, request routing, and a dashboard. Accounts, inventory, health checks, proxy selection, request forwarding, and analytics are in place.

The product is for permitted collection, QA, monitoring, and internal automation. It is not a tool for bypassing authentication, paywalls, CAPTCHA, or other access controls.

## Phase 1 through 9

- pnpm workspaces and Turborepo
- Fastify API with `/health`, `/ready`, and `/api/v1`
- Register, login, logout, organization roles, and hashed API keys
- Providers, proxies, encrypted credentials, import, tags, and pools
- Proxy health checks, scoring, cooldown, and recovery
- Rotation policies, pool selection, and sticky proxy sessions
- Request forwarding, retries, rate limits, and request logs
- Dashboard for proxy health, request outcomes, and monthly usage
- Encoded-address SSRF checks, an empty-by-default host allowlist, and an owner/admin audit log
- OpenAPI 3.1 at `/openapi.json`, plus a standard-library Python SDK and JSON-output CLI
- PostgreSQL via Prisma, including the domain schema and initial migration
- Redis, plus a worker that publishes a heartbeat and consumes health and recovery queues
- Next.js status, account, and inventory pages
- Secret redaction and AES-256-GCM helpers

## Prerequisites

- Node.js 22 or newer
- pnpm 10 (`corepack enable` or the user-local Corepack install)
- Docker Compose. On this machine that is Colima plus the Docker CLI.

## Run locally

```bash
docker compose up -d
pnpm install
pnpm bootstrap:env
pnpm db:migrate
pnpm dev
```

`docker compose up -d` starts Postgres and Redis only. App processes run on the host with `pnpm dev`.

- Web: http://localhost:3000
- API: http://localhost:4000/health and http://localhost:4000/ready

To run the api, worker, and web containers as well:

```bash
docker compose --profile app up --build
```

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Integration tests need the Compose services and a migrated database.

## Layout

```text
apps/web        Next.js status and account shell
apps/api        Fastify
apps/worker     BullMQ worker
packages/*      config, logger, shared, database, Python SDK
tests/integration
```

See [docs/architecture.md](docs/architecture.md), [docs/setup.md](docs/setup.md), and [docs/sdk.md](docs/sdk.md).
