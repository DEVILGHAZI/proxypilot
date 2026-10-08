import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");

if (!existsSync(envPath)) {
  throw new Error(`Missing ${envPath}. Run pnpm bootstrap:env`);
}

process.loadEnvFile(envPath);
