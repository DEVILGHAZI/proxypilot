import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";
import { TargetBlockedError, forwardThroughProxy, resolvePublicTarget } from "./execute.js";

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("test proxy did not bind"));
        return;
      }
      resolve(address.port);
    });
  });
}

describe("forwardThroughProxy", () => {
  it("rejects a loopback target before connecting", async () => {
    await expect(resolvePublicTarget("http://127.0.0.1/secret")).rejects.toBeInstanceOf(TargetBlockedError);
  });

  it("rejects a public name that resolves to a private address", async () => {
    await expect(
      resolvePublicTarget("http://example.com/", {
        lookupHost: async () => [{ address: "10.1.1.1" }, { address: "1.1.1.1" }],
      }),
    ).rejects.toBeInstanceOf(TargetBlockedError);
    const allowed = await resolvePublicTarget("http://example.com/", {
      lookupHost: async () => [{ address: "1.1.1.1" }],
    });
    expect(allowed.hostname).toBe("example.com");
  });

  it("stops a redirect onto loopback", async () => {
    const proxy = createServer((_request, response) => {
      response.writeHead(302, { location: "http://127.0.0.1/latest" });
      response.end();
    });
    const port = await listen(proxy);
    try {
      const result = await forwardThroughProxy({
        protocol: "HTTP",
        host: "127.0.0.1",
        port,
        url: "http://example.com/start",
        method: "GET",
        body: null,
        timeoutMs: 2_000,
        resolveTarget: async (value) => {
          const resolved = await resolvePublicTarget(value, { lookupHost: async () => [{ address: "1.1.1.1" }] });
          return resolved;
        },
      });
      expect(result.errorCode).toBe("TARGET_BLOCKED");
      expect(result.retryable).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("keeps a 401 and retries a 500", async () => {
    const proxy = createServer((request, response) => {
      response.writeHead(request.url?.includes("denied") ? 401 : 500);
      response.end();
    });
    const port = await listen(proxy);
    const resolveTarget = async (value: string) => new URL(value);
    try {
      const denied = await forwardThroughProxy({
        protocol: "HTTP",
        host: "127.0.0.1",
        port,
        url: "http://example.com/denied",
        method: "GET",
        body: null,
        timeoutMs: 2_000,
        resolveTarget,
      });
      const failed = await forwardThroughProxy({
        protocol: "HTTP",
        host: "127.0.0.1",
        port,
        url: "http://example.com/down",
        method: "GET",
        body: null,
        timeoutMs: 2_000,
        resolveTarget,
      });
      expect(denied.httpStatus).toBe(401);
      expect(denied.retryable).toBe(false);
      expect(failed.httpStatus).toBe(500);
      expect(failed.retryable).toBe(true);
      expect(failed.errorCode).toBe("HTTP_5XX");
    } finally {
      await new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
