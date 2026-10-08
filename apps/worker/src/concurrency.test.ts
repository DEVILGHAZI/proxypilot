import { describe, expect, it } from "vitest";
import { queueConcurrency } from "./concurrency.js";

describe("queueConcurrency", () => {
  it("uses configured bounds and never leaves a queue unlimited", () => {
    const concurrency = queueConcurrency({
      HEALTH_CHECK_CONCURRENCY: 20,
      REQUEST_CONCURRENCY: 50,
    });

    expect(concurrency["health-check"]).toBe(20);
    expect(concurrency.request).toBe(50);
    expect(concurrency.retry).toBe(50);
    expect(concurrency["proxy-recovery"]).toBe(10);
    expect(concurrency.analytics).toBe(2);
    expect(concurrency.cleanup).toBe(1);
    expect(concurrency["site-check"]).toBe(1);
    expect(concurrency.system).toBe(2);
    for (const value of Object.values(concurrency)) {
      expect(value).toBeGreaterThan(0);
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("caps proxy recovery concurrency when health checks are few", () => {
    const concurrency = queueConcurrency({
      HEALTH_CHECK_CONCURRENCY: 4,
      REQUEST_CONCURRENCY: 8,
    });
    expect(concurrency["proxy-recovery"]).toBe(4);
  });
});
