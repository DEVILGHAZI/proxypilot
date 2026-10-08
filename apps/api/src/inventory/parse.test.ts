import { describe, expect, it } from "vitest";
import { parseEndpoint, parseProxyImport } from "./parse.js";

describe("proxy import", () => {
  it("parses host:port and username:password@host:port", () => {
    expect(parseEndpoint("10.0.0.8:8000")).toEqual({ host: "10.0.0.8", port: 8000 });
    expect(parseEndpoint("user:secret@proxy.example:3128")).toEqual({
      host: "proxy.example",
      port: 3128,
      username: "user",
      password: "secret",
    });
    expect(parseEndpoint("http://user:secret@[2001:db8::1]:443").host).toBe("2001:db8::1");
  });

  it("parses csv rows and reports a bad line without dropping the rest", () => {
    const parsed = parseProxyImport(
      ["host,port,username,password,protocol,country", "10.1.1.1,8080,ada,secret,socks5,US", "not-a-proxy", "edge.example:9000"].join(
        "\n",
      ),
    );
    expect(parsed.proxies).toEqual([
      {
        host: "10.1.1.1",
        port: 8080,
        username: "ada",
        password: "secret",
        protocol: "SOCKS5",
        country: "US",
      },
      { host: "edge.example", port: 9000 },
    ]);
    expect(parsed.errors).toEqual([{ line: 3, message: "expected host:port" }]);
  });
});
