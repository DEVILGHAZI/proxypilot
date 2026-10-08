import { describe, expect, it } from "vitest";
import { siteCheckLayout, siteCheckSummary } from "./site-check.js";

describe("site checks", () => {
  it("assigns a chrome or phone layout", () => {
    expect(siteCheckLayout("CHROME", 1)).toBe("chrome");
    expect(siteCheckLayout("PHONE", 0)).toBe("phone");
    expect(siteCheckLayout("MIXED", 0)).toBe("chrome");
    expect(siteCheckLayout("MIXED", 1)).toBe("phone");
  });

  it("summarizes a finished run", () => {
    expect(siteCheckSummary(1, 1)).toBe("Your site loaded on all 1 proxy.");
    expect(siteCheckSummary(2, 2)).toBe("Your site loaded on all 2 proxies.");
    expect(siteCheckSummary(1, 3)).toBe("Your site loaded on 1 of 3 proxies.");
  });
});
