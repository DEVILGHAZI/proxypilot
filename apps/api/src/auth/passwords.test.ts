import { describe, expect, it } from "vitest";
import { dummyPasswordHash, hashPassword, verifyPassword } from "./passwords.js";

describe("passwords", () => {
  it("verifies an argon2id hash and rejects a different password", async () => {
    const stored = await hashPassword("correct-horse-battery");
    expect(stored.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(stored, "correct-horse-battery")).toBe(true);
    expect(await verifyPassword(stored, "wrong-horse-battery")).toBe(false);
    expect(await verifyPassword(await dummyPasswordHash(), "correct-horse-battery")).toBe(false);
  });
});
