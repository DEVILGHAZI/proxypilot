import { describe, expect, it } from "vitest";
import { ProxyStatus } from "./enums.js";
import {
  applyScore,
  latencyAverage,
  nextCooldownSeconds,
  statusForScore,
  type HealthOutcome,
} from "./health.js";

function outcome(kind: HealthOutcome["kind"]): HealthOutcome {
  return { kind, latencyMs: 25 };
}

const healthy = {
  status: ProxyStatus.HEALTHY,
  healthScore: 100,
  failureCount: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
};

describe("health score", () => {
  it("maps scores onto healthy, degraded, and quarantined", () => {
    expect(statusForScore(70)).toBe(ProxyStatus.HEALTHY);
    expect(statusForScore(69)).toBe(ProxyStatus.DEGRADED);
    expect(statusForScore(40)).toBe(ProxyStatus.DEGRADED);
    expect(statusForScore(39)).toBe(ProxyStatus.QUARANTINED);
  });

  it("applies the documented deltas and an extra penalty for a repeated failure", () => {
    expect(applyScore(healthy, outcome("success")).healthScore).toBe(100);
    expect(applyScore(healthy, outcome("http_5xx")).healthScore).toBe(95);
    expect(applyScore(healthy, outcome("timeout")).healthScore).toBe(85);
    const first = applyScore(healthy, outcome("connection_failure"));
    expect(first.healthScore).toBe(80);
    expect(first.repeatedFailure).toBe(false);
    const second = applyScore(
      {
        ...healthy,
        healthScore: 80,
        failureCount: 1,
        lastFailureAt: new Date("2026-10-07T00:00:00.000Z"),
      },
      outcome("connection_failure"),
    );
    expect(second.delta).toBe(-30);
    expect(second.healthScore).toBe(50);
    expect(second.status).toBe(ProxyStatus.DEGRADED);
  });

  it("lands the first quarantine recovery in degraded and lets a later success return to healthy", () => {
    const recovered = applyScore(
      {
        status: ProxyStatus.QUARANTINED,
        healthScore: 20,
        failureCount: 4,
        lastSuccessAt: null,
        lastFailureAt: new Date("2026-10-07T00:00:00.000Z"),
      },
      outcome("success"),
    );
    expect(recovered.status).toBe(ProxyStatus.DEGRADED);
    expect(recovered.healthScore).toBe(40);
    expect(recovered.recoveredFromQuarantine).toBe(true);

    const capped = applyScore(
      {
        status: ProxyStatus.QUARANTINED,
        healthScore: 90,
        failureCount: 1,
        lastSuccessAt: null,
        lastFailureAt: new Date("2026-10-07T00:00:00.000Z"),
      },
      outcome("success"),
    );
    expect(capped.status).toBe(ProxyStatus.DEGRADED);
    expect(capped.healthScore).toBe(69);

    const restored = applyScore(
      {
        status: ProxyStatus.DEGRADED,
        healthScore: 68,
        failureCount: 1,
        lastSuccessAt: new Date("2026-10-07T00:01:00.000Z"),
        lastFailureAt: new Date("2026-10-07T00:00:00.000Z"),
      },
      outcome("success"),
    );
    expect(restored.status).toBe(ProxyStatus.HEALTHY);
    expect(restored.healthScore).toBe(70);
  });

  it("keeps a disabled proxy disabled", () => {
    const next = applyScore(
      { ...healthy, status: ProxyStatus.DISABLED, healthScore: 90 },
      outcome("connection_failure"),
    );
    expect(next.status).toBe(ProxyStatus.DISABLED);
    expect(next.healthScore).toBe(70);
  });

  it("doubles quarantine cooldown and stops at the cap", () => {
    expect(
      nextCooldownSeconds({
        alreadyQuarantined: false,
        previousCooldownSeconds: 0,
        baseSeconds: 60,
        maxSeconds: 3_600,
      }),
    ).toBe(60);
    expect(
      nextCooldownSeconds({
        alreadyQuarantined: true,
        previousCooldownSeconds: 60,
        baseSeconds: 60,
        maxSeconds: 3_600,
      }),
    ).toBe(120);
    expect(
      nextCooldownSeconds({
        alreadyQuarantined: true,
        previousCooldownSeconds: 3_600,
        baseSeconds: 60,
        maxSeconds: 3_600,
      }),
    ).toBe(3_600);
  });

  it("smooths latency instead of replacing it", () => {
    expect(latencyAverage(null, 40)).toBe(40);
    expect(latencyAverage(100, 40)).toBe(82);
  });
});
