import { describe, expect, it } from "vitest";
import { LOGIN_FAILURE_LIMIT } from "@proxypilot/shared";
import type { ApiError } from "../http-error.js";
import { assertLoginAllowed, clearLoginFailures, recordLoginFailure, type LoginCounter } from "./throttle.js";

function memoryCounter(): LoginCounter & { values: Map<string, number> } {
  const values = new Map<string, number>();
  return {
    values,
    async get(key) {
      const value = values.get(key);
      return value === undefined ? null : String(value);
    },
    async incr(key) {
      const next = (values.get(key) ?? 0) + 1;
      values.set(key, next);
      return next;
    },
    async expire() {
      return 1;
    },
    async del(key) {
      values.delete(key);
      return 1;
    },
  };
}

describe("login throttle", () => {
  it("blocks after the failure limit and clears on success", async () => {
    const counter = memoryCounter();
    for (let attempt = 0; attempt < LOGIN_FAILURE_LIMIT; attempt += 1) {
      await recordLoginFailure(counter, "a@example.com", "127.0.0.1");
    }
    await expect(assertLoginAllowed(counter, "a@example.com", "127.0.0.1")).rejects.toMatchObject({
      statusCode: 429,
      code: "RATE_LIMITED",
    } satisfies Partial<ApiError>);
    await clearLoginFailures(counter, "a@example.com", "127.0.0.1");
    await expect(assertLoginAllowed(counter, "a@example.com", "127.0.0.1")).resolves.toBeUndefined();
  });
});
