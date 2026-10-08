import { describe, expect, it } from "vitest";
import { ProxyStatus, RotationStrategy } from "./enums.js";
import { eligibleProxies, pickProxy, type RotationCandidate } from "./rotation.js";

const now = new Date("2026-10-07T12:00:00.000Z");

function candidate(overrides: Partial<RotationCandidate> & Pick<RotationCandidate, "id">): RotationCandidate {
  return {
    status: ProxyStatus.HEALTHY,
    healthScore: 100,
    avgLatencyMs: 50,
    cooldownUntil: null,
    ...overrides,
  };
}

const pool = [
  candidate({ id: "b", healthScore: 80, avgLatencyMs: 40 }),
  candidate({ id: "a", healthScore: 40, avgLatencyMs: 10, status: ProxyStatus.DEGRADED }),
  candidate({ id: "c", status: ProxyStatus.DISABLED, healthScore: 100 }),
  candidate({ id: "d", status: ProxyStatus.QUARANTINED, healthScore: 10 }),
  candidate({ id: "e", cooldownUntil: new Date("2026-10-07T13:00:00.000Z") }),
];

describe("rotation", () => {
  it("keeps healthy and degraded proxies whose cooldown has passed", () => {
    expect(eligibleProxies(pool, now).map((proxy) => proxy.id)).toEqual(["a", "b"]);
  });

  it("walks round robin in id order", () => {
    expect(pickProxy({ strategy: RotationStrategy.ROUND_ROBIN, candidates: pool, cursor: 1, now })?.id).toBe("a");
    expect(pickProxy({ strategy: RotationStrategy.ROUND_ROBIN, candidates: pool, cursor: 2, now })?.id).toBe("b");
    expect(pickProxy({ strategy: RotationStrategy.ROUND_ROBIN, candidates: pool, cursor: 3, now })?.id).toBe("a");
  });

  it("picks the lowest known latency", () => {
    expect(pickProxy({ strategy: RotationStrategy.LEAST_LATENCY, candidates: pool, cursor: 1, now })?.id).toBe("a");
  });

  it("weights the draw by health score", () => {
    const draws = [0, 0.2, 0.9].map(
      (roll) => pickProxy({ strategy: RotationStrategy.WEIGHTED_HEALTH, candidates: pool, cursor: 1, now, random: () => roll })?.id,
    );
    expect(draws).toEqual(["a", "a", "b"]);
  });

  it("returns null when every proxy is ineligible", () => {
    expect(
      pickProxy({
        strategy: RotationStrategy.RANDOM,
        candidates: [candidate({ id: "c", status: ProxyStatus.DISABLED })],
        cursor: 1,
        now,
      }),
    ).toBeNull();
  });
});