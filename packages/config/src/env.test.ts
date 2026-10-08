import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: "postgresql://proxypilot:proxypilot@localhost:5432/proxypilot",
    REDIS_URL: "redis://localhost:6379",
    SESSION_SECRET: "s".repeat(32),
    JWT_SECRET: "j".repeat(32),
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    ...overrides,
  };
}

describe("parseEnv", () => {
  it("applies numeric defaults and coerces strings", () => {
    const config = parseEnv(
      validEnv({
        HEALTH_CHECK_CONCURRENCY: "12",
        REQUEST_CONCURRENCY: "40",
        DEFAULT_MAX_RETRIES: "2",
      }),
    );

    expect(config.HEALTH_CHECK_CONCURRENCY).toBe(12);
    expect(config.REQUEST_CONCURRENCY).toBe(40);
    expect(config.DEFAULT_MAX_RETRIES).toBe(2);
    expect(config.API_PORT).toBe(4000);
    expect(config.DEFAULT_REQUEST_TIMEOUT).toBe(30_000);
    expect(config.ORG_REQUESTS_PER_SECOND).toBe(100);
    expect(config.USER_REQUESTS_PER_SECOND).toBe(30);
    expect(config.API_KEY_REQUESTS_PER_SECOND).toBe(30);
    expect(config.DOMAIN_REQUESTS_PER_SECOND).toBe(20);
    expect(config.SSRF_ALLOW_HOSTS).toBe("");
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.HEALTH_CHECK_URL).toBe("https://example.com/");
    expect(config.HEALTH_CHECK_INTERVAL_SECONDS).toBe(60);
    expect(config.HEALTH_COOLDOWN_SECONDS).toBe(60);
    expect(config.HEALTHY_SCORE_MIN).toBe(70);
    expect(config.DEGRADED_SCORE_MIN).toBe(40);
  });

  it("rejects a health check url with credentials", () => {
    expect(() => parseEnv(validEnv({ HEALTH_CHECK_URL: "https://user:secret@example.com/" }))).toThrow(/HEALTH_CHECK_URL/);
  });

  it("rejects a missing session secret", () => {
    expect(() => parseEnv(validEnv({ SESSION_SECRET: undefined }))).toThrow(/SESSION_SECRET/);
  });

  it("rejects a short jwt secret", () => {
    expect(() => parseEnv(validEnv({ JWT_SECRET: "too-short" }))).toThrow(/JWT_SECRET/);
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    expect(() => parseEnv(validEnv({ ENCRYPTION_KEY: Buffer.from("short").toString("base64") }))).toThrow(
      /ENCRYPTION_KEY/,
    );
  });

  it("rejects an allowlist wildcard", () => {
    expect(() => parseEnv(validEnv({ SSRF_ALLOW_HOSTS: "*" }))).toThrow(/SSRF_ALLOW_HOSTS/);
    expect(parseEnv(validEnv({ SSRF_ALLOW_HOSTS: "127.0.0.1, lab.internal" })).SSRF_ALLOW_HOSTS).toBe(
      "127.0.0.1, lab.internal",
    );
  });

  it("rejects a non-redis url", () => {
    expect(() => parseEnv(validEnv({ REDIS_URL: "http://localhost:6379" }))).toThrow(/REDIS_URL/);
  });
});
