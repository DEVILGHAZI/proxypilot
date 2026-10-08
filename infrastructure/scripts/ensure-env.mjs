import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = path.join(root, ".env");
const databaseEnvPath = path.join(root, "packages/database/.env");

if (!existsSync(envPath)) {
  const sessionSecret = randomBytes(32).toString("base64url");
  const jwtSecret = randomBytes(32).toString("base64url");
  const encryptionKey = randomBytes(32).toString("base64");
  const contents = [
    "DATABASE_URL=postgresql://proxypilot:proxypilot@localhost:5432/proxypilot",
    "REDIS_URL=redis://localhost:6379",
    `SESSION_SECRET=${sessionSecret}`,
    `JWT_SECRET=${jwtSecret}`,
    `ENCRYPTION_KEY=${encryptionKey}`,
    "API_BASE_URL=http://localhost:4000",
    "LOG_LEVEL=info",
    "HEALTH_CHECK_CONCURRENCY=20",
    "REQUEST_CONCURRENCY=50",
    "DEFAULT_REQUEST_TIMEOUT=30000",
    "DEFAULT_MAX_RETRIES=3",
    "NODE_ENV=development",
    "API_HOST=0.0.0.0",
    "API_PORT=4000",
    "WEB_ORIGIN=http://localhost:3000",
    "",
  ].join("\n");
  writeFileSync(envPath, contents, { mode: 0o600 });
}

mkdirSync(path.dirname(databaseEnvPath), { recursive: true });
copyFileSync(envPath, databaseEnvPath);
