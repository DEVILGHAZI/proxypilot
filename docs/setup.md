# Setup

## Tools

Node.js 22 or newer. pnpm 10.18.2 is declared in the root `packageManager` field.

Docker is required for Postgres and Redis. If `docker` is not on your PATH, install Colima and the Compose plugin:

```bash
brew install colima docker docker-compose
mkdir -p ~/.docker/cli-plugins
ln -sfn "$(brew --prefix)/lib/docker/cli-plugins/docker-compose" ~/.docker/cli-plugins/docker-compose
colima start --cpu 2 --memory 4 --disk 20
```

Add `/opt/homebrew/lib/docker/cli-plugins` to `cliPluginsExtraDirs` in `~/.docker/config.json` if `docker compose` cannot find the plugin.

## First run

From the repository root:

```bash
docker compose up -d
pnpm install
pnpm bootstrap:env
pnpm db:migrate
pnpm dev
```

`pnpm bootstrap:env` writes `.env` and `packages/database/.env` when they are missing. It generates `SESSION_SECRET`, `JWT_SECRET`, and a 32-byte `ENCRYPTION_KEY`. Those files are gitignored. `.env.example` lists the variables with empty secrets.

## What comes up

- Postgres `proxypilot` / `proxypilot` on port 5432, database `proxypilot`
- Redis on port 6379
- API on port 4000
- Web on port 3000
- Worker with no host port

Confirm:

```bash
curl -sS http://localhost:4000/health
curl -sS http://localhost:4000/ready
```

`/ready` returns 200 when Postgres and Redis answer. `worker` is `up` after the worker has written a heartbeat, and `unknown` when the key is absent. A missing worker does not fail readiness.

## Migrations

Schema: `packages/database/prisma/schema.prisma`.

```bash
pnpm db:migrate
```

That runs `prisma migrate deploy` against `DATABASE_URL`.

## Full Compose profile

```bash
docker compose --profile app up --build
```

The API container runs migrations before listen. Container `DATABASE_URL` and `REDIS_URL` point at the Compose service names, overriding the localhost values in `.env`.

## Tests

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`pnpm test` includes unit tests and `tests/integration`, which need Compose and an applied migration.
