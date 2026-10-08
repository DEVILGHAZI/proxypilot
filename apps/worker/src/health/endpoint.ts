const USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi;

export function sanitizeProbeMessage(message: string): string {
  return message.replace(USERINFO, "$1").replace(/\s+/g, " ").trim().slice(0, 200);
}

export function proxyEndpoint(input: {
  protocol: "HTTP" | "HTTPS" | "SOCKS5";
  host: string;
  port: number;
  username?: string;
  password?: string;
}): string {
  const scheme = input.protocol === "SOCKS5" ? "socks5" : input.protocol === "HTTPS" ? "https" : "http";
  const host = input.host.includes(":") && !input.host.startsWith("[") ? `[${input.host}]` : input.host;
  const auth =
    input.username === undefined
      ? ""
      : `${encodeURIComponent(input.username)}:${encodeURIComponent(input.password ?? "")}@`;
  return `${scheme}://${auth}${host}:${input.port}`;
}
