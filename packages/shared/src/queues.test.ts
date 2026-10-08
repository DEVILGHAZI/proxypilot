import { describe, expect, it } from "vitest";
import { QUEUE_NAMES, REQUIRED_QUEUE_NAMES } from "./queues.js";

describe("queue names", () => {
  it("declares the product queues used by the worker", () => {
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
    expect(new Set(Object.values(QUEUE_NAMES)).size).toBe(Object.values(QUEUE_NAMES).length);
  });
});
