import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: path.join(root, ".env") });

const { checkDatabase, disconnectDatabase, getPrisma } = await import("./client.js");

describe("postgres", () => {
  afterAll(async () => {
    await disconnectDatabase();
  });

  it("answers SELECT 1", async () => {
    await expect(checkDatabase()).resolves.toBeUndefined();
  });

  it("records the initial migration", async () => {
    const rows = await getPrisma().$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    expect(rows.some((row) => row.migration_name.includes("init"))).toBe(true);
  });
});
