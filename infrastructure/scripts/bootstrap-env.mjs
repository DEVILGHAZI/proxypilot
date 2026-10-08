import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = path.join(root, ".env");
const databaseDir = path.join(root, "packages/database");
const databaseTarget = path.join(databaseDir, ".env");
const force = process.argv.includes("--force");

function render() {
  const session = randomBytes(32).toString("hex");
  const jwt = randomBytes(32).toString("hex");
  const encryption = randomBytes(32).toString("base64");
  return [
    "DATABASE_URL=postgresql://proxypilot:proxypilot@localhost:5432/proxypilot",
    "REDIS_URL=redis://localhost:6379",
    `SESSION_SECRET=${session}`,
    `JWT_SECRET=${jwt}`,
    `ENCRYPTION_KEY=${encryption}`,
    "API_BASE_URL=http://localhost:4000",
    "WEB_ORIGIN=http://localhost:3000",
    "API_HOST=0.0.0.0",
    "API_PORT=4000",
    "LOG_LEVEL=info",
    "NODE_ENV=development",
    "HEALTH_CHECK_CONCURRENCY=20",
    "REQUEST_CONCURRENCY=50",
    "DEFAULT_REQUEST_TIMEOUT=30000",
    "DEFAULT_MAX_RETRIES=3",
    "",
  ].join("\n");
}

mkdirSync(databaseDir, { recursive: true });

if (!existsSync(target) || force) {
  const body = render();
  writeFileSync(target, body);
  writeFileSync(databaseTarget, body);
  process.stdout.write("Wrote .env and packages/database/.env\n");
} else if (!existsSync(databaseTarget)) {
  writeFileSync(databaseTarget, render());
  process.stdout.write("Wrote packages/database/.env\n");
} else {
  process.stdout.write(".env already exists\n");
}
