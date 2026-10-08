import { describe, expect, it } from "vitest";
import { apiFailure } from "./errors.js";
import { ID_PREFIX, QUEUE_NAMES, REQUIRED_QUEUE_NAMES } from "./queues.js";

describe("apiFailure", () => {
  it("matches the platform error envelope", () => {
    expect(apiFailure("req_123", "PROXY_UNAVAILABLE", "No healthy proxy is currently available.")).toEqual({
      success: false,
      requestId: "req_123",
      error: {
        code: "PROXY_UNAVAILABLE",
        message: "No healthy proxy is currently available.",
      },
    });
  });
});

describe("queues", () => {
  it("declares the platform queues and public id prefixes", () => {
    expect(REQUIRED_QUEUE_NAMES).toEqual([
      "health-check",
      "request",
      "retry",
      "proxy-recovery",
      "analytics",
      "cleanup",
      "site-check",
    ]);
    expect(QUEUE_NAMES.system).toBe("system");
    expect(ID_PREFIX.apiKey).toBe("pp_live");
    expect(ID_PREFIX.request).toBe("req");
  });
});
