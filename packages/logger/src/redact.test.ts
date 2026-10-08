import { describe, expect, it } from "vitest";
import { redactSecrets, redactString } from "./redact.js";

describe("redactSecrets", () => {
  it("redacts credential fields and nested headers", () => {
    const redacted = redactSecrets({
      password: "hunter2",
      username: "proxy-user",
      headers: {
        Authorization: "Bearer abc.def.ghi",
        Cookie: "session=1",
        "Set-Cookie": "session=1",
        "Proxy-Authorization": "Basic eHg=",
      },
      meta: {
        apiKey: "pp_live_abcdefghijklmnopqrstuvwxyz",
        jwt: "header.payload.sig",
      },
    });

    expect(redacted.password).toBe("[REDACTED]");
    expect(redacted.username).toBe("[REDACTED]");
    expect(redacted.headers.Authorization).toBe("[REDACTED]");
    expect(redacted.headers.Cookie).toBe("[REDACTED]");
    expect(redacted.headers["Set-Cookie"]).toBe("[REDACTED]");
    expect(redacted.headers["Proxy-Authorization"]).toBe("[REDACTED]");
    expect(redacted.meta.apiKey).toBe("[REDACTED]");
    expect(redacted.meta.jwt).toBe("[REDACTED]");
  });

  it("redacts secrets embedded in strings", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const text = redactString(
      `https://user:secret@example.com/path Bearer ${jwt} key pp_live_abc123xyz token ${jwt}`,
    );

    expect(text).not.toContain("secret");
    expect(text).not.toContain("pp_live_abc123xyz");
    expect(text).not.toContain(jwt);
    expect(text).toContain("https://[REDACTED]:[REDACTED]@example.com/path");
  });

  it("leaves ordinary fields intact and handles cycles", () => {
    const record: Record<string, unknown> = { host: "203.0.113.10", port: 8080 };
    record.self = record;

    const redacted = redactSecrets(record);
    expect(redacted.host).toBe("203.0.113.10");
    expect(redacted.port).toBe(8080);
    expect(redacted.self).toBe("[Circular]");
  });

  it("redacts error messages without dropping the error name", () => {
    const redacted = redactSecrets(new Error("proxy password=hunter2"));
    expect(redacted.name).toBe("Error");
    expect(redacted.message).not.toContain("hunter2");
  });
});
