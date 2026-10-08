import { describe, expect, it } from "vitest";
import { pageLoaded, visitErrorCode } from "./visit.js";

describe("browser visit", () => {
  it("accepts a page that has a title or visible text", () => {
    expect(pageLoaded(200, "Start Yoga 360", 0)).toBe(true);
    expect(pageLoaded(200, "", 40)).toBe(true);
    expect(pageLoaded(500, "Error", 40)).toBe(false);
    expect(pageLoaded(200, " ", 0)).toBe(false);
  });

  it("names a missing Chrome install", () => {
    expect(visitErrorCode(new Error("Chromium distribution 'chrome' is not found"))).toBe("CHROME_UNAVAILABLE");
    expect(visitErrorCode(new Error("Timeout 30000ms exceeded"))).toBe("TIMEOUT");
    expect(visitErrorCode(new Error("net::ERR_PROXY_CONNECTION_FAILED"))).toBe("VISIT_FAILED");
  });
});
