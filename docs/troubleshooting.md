# Troubleshooting

## `docker compose` is not a command

The Homebrew `docker` CLI does not always see the Compose plugin. Link it:

```bash
mkdir -p ~/.docker/cli-plugins
ln -sfn "$(brew --prefix)/lib/docker/cli-plugins/docker-compose" ~/.docker/cli-plugins/docker-compose
```

`colima status` should say Running. If it does not, `colima start --cpu 2 --memory 4 --disk 20`.

## Port 5432 or 6379 is taken

Another Postgres or Redis is bound on the host. Stop it, or change the host port in `docker-compose.yml` and the matching URL in `.env`. Container-to-container URLs stay on 5432 and 6379.

## `/ready` returns 503

Postgres or Redis is down, or `DATABASE_URL` / `REDIS_URL` point somewhere else. `docker compose ps` should show both services healthy. The API log line is redacted; a database password in the URL will not be printed.

`worker: unknown` with HTTP 200 means the API is ready and the worker has not written `worker:heartbeat`. Start the worker with `pnpm dev` or the Compose `app` profile.

## Prisma cannot see `DATABASE_URL`

`pnpm bootstrap:env` writes both `.env` and `packages/database/.env`. Prisma reads the file next to the database package. Shell exports win over the file.

## Invalid environment on boot

`SESSION_SECRET` and `JWT_SECRET` must be at least 32 characters. `ENCRYPTION_KEY` must be 32 bytes of base64. Empty values copied from `.env.example` fail on purpose. Run `pnpm bootstrap:env` or `node infrastructure/scripts/bootstrap-env.mjs --force`. `--force` replaces the files.

## Integration tests fail immediately

They load the root `.env` and expect migrated Postgres plus Redis. Run `docker compose up -d`, `pnpm bootstrap:env`, and `pnpm db:migrate` first.

## Next.js cannot reach the API

The status page reads `API_BASE_URL` on the server. The default is `http://localhost:4000`. Inside the web container, Compose sets `API_BASE_URL=http://api:4000`.
