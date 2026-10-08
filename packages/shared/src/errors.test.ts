import { describe, expect, it } from "vitest";
import { apiFailure } from "./errors.js";

describe("error envelope", () => {
  it("builds the public failure shape", () => {
    expect(apiFailure("req_123", "NOT_READY", "One or more dependencies are unavailable.")).toEqual({
      success: false,
      error: {
        code: "NOT_READY",
        message: "One or more dependencies are unavailable.",
      },
      requestId: "req_123",
    });
  });

  it("does not attach a stack to the envelope", () => {
    const body = apiFailure("req_abc", "INTERNAL_ERROR", "An unexpected error occurred.");
    expect(body.success).toBe(false);
    expect(body).not.toHaveProperty("stack");
    expect(JSON.stringify(body)).not.toContain("stack");
  });
});
