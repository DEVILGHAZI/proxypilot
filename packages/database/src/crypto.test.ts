import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeEncryptionKey, decryptString, encryptString } from "./crypto.js";

describe("credential encryption", () => {
  it("round-trips a proxy password", () => {
    const key = randomBytes(32);
    const payload = encryptString("proxy-password", key);
    expect(payload).not.toContain("proxy-password");
    expect(decryptString(payload, key)).toBe("proxy-password");
  });

  it("rejects a truncated key and a tampered payload", () => {
    expect(() => decodeEncryptionKey(Buffer.from("short").toString("base64"))).toThrow(/32 bytes/);
    const key = randomBytes(32);
    const payload = encryptString("secret", key);
    const other = randomBytes(32);
    expect(() => decryptString(payload, other)).toThrow();
  });
});
