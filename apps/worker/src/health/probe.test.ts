import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";
import { probeProxy } from "./probe.js";
import { proxyEndpoint, sanitizeProbeMessage } from "./endpoint.js";

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

describe("probeProxy", () => {
  it("strips proxy userinfo from error text", () => {
    expect(sanitizeProbeMessage("connect failed via http://ada:hidden@10.0.0.8:8080/path")).toBe(
      "connect failed via http://10.0.0.8:8080/path",
    );
  });

  it("builds an http proxy url without putting the password in the clear host", () => {
    const url = new URL(proxyEndpoint({ protocol: "HTTP", host: "10.0.0.8", port: 8080, username: "ada", password: "hidden" }));
    expect(url.username).toBe("ada");
    expect(url.password).toBe("hidden");
    expect(url.hostname).toBe("10.0.0.8");
    expect(proxyEndpoint({ protocol: "SOCKS5", host: "::1", port: 1080 })).toBe("socks5://[::1]:1080");
  });

  it("records a success when an http proxy returns a non-5xx response", async () => {
    const proxy = createServer((_request, response) => {
      response.writeHead(204);
      response.end();
    });
    const port = await listen(proxy);
    try {
      const outcome = await probeProxy({
        protocol: "HTTP",
        host: "127.0.0.1",
        port,
        targetUrl: "http://example.com/",
        timeoutMs: 2_000,
      });
      expect(outcome.kind).toBe("success");
      expect(outcome.httpStatus).toBe(204);
    } finally {
      await new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("classifies a refused port as a connection failure", async () => {
    const outcome = await probeProxy({
      protocol: "HTTP",
      host: "127.0.0.1",
      port: 1,
      targetUrl: "http://example.com/",
      timeoutMs: 1_000,
    });
    expect(outcome.kind).toBe("connection_failure");
    expect(outcome.errorCode).toBe("CONNECTION_REFUSED");
    expect(outcome.errorMessage ?? "").not.toMatch(/password|hidden/);
  });
});
