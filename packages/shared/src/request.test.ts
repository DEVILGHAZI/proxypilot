import { describe, expect, it } from "vitest";
import {
  backoffDelayMs,
  inspectTargetUrl,
  isBlockedAddress,
  isRetryableHttpStatus,
  rateWindowKey,
  requestJobId,
} from "./request.js";

describe("request rules", () => {
  it("backs off and caps the delay", () => {
    expect(backoffDelayMs(0)).toBe(200);
    expect(backoffDelayMs(1)).toBe(400);
    expect(backoffDelayMs(2)).toBe(800);
    expect(backoffDelayMs(20)).toBe(8_000);
  });

  it("retries gateway and rate-limit responses, and keeps 401 and 403", () => {
    expect(isRetryableHttpStatus(401)).toBe(false);
    expect(isRetryableHttpStatus(403)).toBe(false);
    expect(isRetryableHttpStatus(404)).toBe(false);
    expect(isRetryableHttpStatus(408)).toBe(true);
    expect(isRetryableHttpStatus(429)).toBe(true);
    expect(isRetryableHttpStatus(500)).toBe(true);
    expect(isRetryableHttpStatus(200)).toBe(false);
  });

  it("accepts a public http url and rejects local, metadata, and credential targets", () => {
    expect(inspectTargetUrl("https://example.com/docs").ok).toBe(true);
    expect(inspectTargetUrl("http://127.0.0.1/latest").ok).toBe(false);
    expect(inspectTargetUrl("http://localhost/").ok).toBe(false);
    expect(inspectTargetUrl("http://169.254.169.254/latest").ok).toBe(false);
    expect(inspectTargetUrl("http://10.1.2.3/").ok).toBe(false);
    expect(inspectTargetUrl("http://[::1]/").ok).toBe(false);
    expect(inspectTargetUrl("http://user:secret@example.com/").ok).toBe(false);
    expect(inspectTargetUrl("http://2130706433/").ok).toBe(false);
    expect(inspectTargetUrl("http://0177.0.0.1/").ok).toBe(false);
    expect(inspectTargetUrl("http://127.1/").ok).toBe(false);
    expect(inspectTargetUrl("http://0x7f.0.0.1/").ok).toBe(false);
    expect(inspectTargetUrl("http://0x7f000001/").ok).toBe(false);
    expect(inspectTargetUrl("http://[::ffff:7f00:1]/").ok).toBe(false);
    expect(inspectTargetUrl("http://[fe80::1%25eth0]/").ok).toBe(false);
    expect(inspectTargetUrl("http://metadata.google.internal/").ok).toBe(false);
    expect(inspectTargetUrl("file:///etc/passwd").ok).toBe(false);
    expect(inspectTargetUrl("http://127.0.0.1/", new Set(["127.0.0.1"])).ok).toBe(true);
    expect(inspectTargetUrl("http://10.0.0.8/", new Set(["127.0.0.1"])).ok).toBe(false);
    expect(inspectTargetUrl("http://user:secret@127.0.0.1/", new Set(["127.0.0.1"])).ok).toBe(false);
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("192.168.1.20")).toBe(true);
  });

  it("builds queue and rate-limit keys without a colon in the job id", () => {
    expect(requestJobId("abc")).toBe("request-abc");
    expect(requestJobId("abc")).not.toContain(":");
    expect(rateWindowKey("policy", "pol_1", 5_000)).toBe("rl:policy:pol_1:5");
  });
});
