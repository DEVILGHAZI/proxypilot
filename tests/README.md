# Tests

Unit tests live next to the code they cover and run with Vitest.

- `packages/config` — environment parsing
- `packages/logger` — secret redaction
- `packages/shared` — error envelope and queue names
- `packages/database` — AES-256-GCM and Prisma enum alignment
- `apps/worker` — bounded queue concurrency
- `apps/api` — health, error envelope, and readiness failure

Integration tests use the `*.integration.test.ts` suffix and require Docker Postgres and Redis:

- `packages/database/src/connection.integration.test.ts`
- `apps/api/src/ready.integration.test.ts`
- `apps/worker/src/ping.integration.test.ts`

Run everything with `pnpm test` after `docker compose up -d` and `pnpm db:migrate`.
