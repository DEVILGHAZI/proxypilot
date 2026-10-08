# Deployment

Phase 1 deploys with Docker Compose. Kubernetes is intentionally not part of this phase.

## Local infrastructure

```bash
docker compose up -d
```

Postgres 16 and Redis 7, with health checks and named volumes `postgres_data` and `redis_data`.

## Application containers

```bash
docker compose --profile app up --build
```

Images use `node:22-bookworm-slim` and pnpm 10.18.2. The API image installs OpenSSL for the Prisma engine, builds `@proxypilot/api`, and runs migrations before `node dist/index.js`. The worker image builds `@proxypilot/worker`. The web image builds Next.js and serves it on port 3000.

Secrets come from `.env` via `env_file`. Compose overrides `DATABASE_URL` and `REDIS_URL` so containers use service DNS names. Do not bake `.env` into images. `.dockerignore` excludes it.

## Backups

Phase 10 adds scheduled backups. Until then, dump Postgres with the volume mounted:

```bash
docker compose exec postgres pg_dump -U proxypilot proxypilot > proxypilot.sql
```

Redis AOF is enabled. It is a queue and heartbeat store. Do not treat it as the only copy of users, proxies, or request history.

## Scaling

One API process and one worker are enough for development. Later, run more API replicas behind a load balancer and more workers against the same Redis. Queue concurrency stays in environment variables. Do not raise it by editing source.
