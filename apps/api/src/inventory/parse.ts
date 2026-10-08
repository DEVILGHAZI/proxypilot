import { ProxyProtocol } from "@proxypilot/shared";
import type { ProxyProtocol as ProxyProtocolName } from "@proxypilot/shared";

export const MAX_IMPORT_LINES = 500;

export type ParsedProxy = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol?: ProxyProtocolName;
  country?: string;
};

export type ImportIssue = {
  line: number;
  message: string;
};

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i;
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

function isHost(host: string): boolean {
  if (host.length < 1 || host.length > 253) {
    return false;
  }
  if (host.includes(":")) {
    return IPV6.test(host);
  }
  return IPV4.test(host) || HOST.test(host);
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error("port must be an integer");
  }
  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new Error("port must be between 1 and 65535");
  }
  return port;
}

function parseProtocol(value: string | undefined): ProxyProtocolName | undefined {
  if (!value) {
    return undefined;
  }
  const protocol = value.trim().toUpperCase();
  if (protocol !== ProxyProtocol.HTTP && protocol !== ProxyProtocol.HTTPS && protocol !== ProxyProtocol.SOCKS5) {
    throw new Error("protocol must be HTTP, HTTPS, or SOCKS5");
  }
  return protocol;
}

export function parseEndpoint(line: string): ParsedProxy {
  let rest = line.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  let username: string | undefined;
  let password: string | undefined;
  const at = rest.lastIndexOf("@");
  if (at !== -1) {
    const auth = rest.slice(0, at);
    rest = rest.slice(at + 1);
    const colon = auth.indexOf(":");
    if (colon === -1) {
      throw new Error("expected username:password@host:port");
    }
    username = decodeURIComponent(auth.slice(0, colon));
    password = decodeURIComponent(auth.slice(colon + 1));
  }

  let host: string;
  let portText: string;
  if (rest.startsWith("[")) {
    const end = rest.indexOf("]");
    if (end < 0 || rest[end + 1] !== ":") {
      throw new Error("expected [host]:port");
    }
    host = rest.slice(1, end);
    portText = rest.slice(end + 2);
  } else {
    const colon = rest.lastIndexOf(":");
    if (colon <= 0) {
      throw new Error("expected host:port");
    }
    host = rest.slice(0, colon);
    portText = rest.slice(colon + 1);
  }

  if (!isHost(host)) {
    throw new Error("invalid host");
  }
  return {
    host,
    port: parsePort(portText),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  };
}

function parseCsvCells(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (quoted) {
    throw new Error("unclosed quote");
  }
  cells.push(current.trim());
  return cells;
}

function parseCsvLine(line: string): ParsedProxy {
  const cells = parseCsvCells(line);
  const host = cells[0] ?? "";
  if (!isHost(host)) {
    throw new Error("invalid host");
  }
  const username = cells[2] || undefined;
  const password = cells[3] || undefined;
  const protocol = parseProtocol(cells[4]);
  const country = cells[5] || undefined;
  return {
    host,
    port: parsePort(cells[1] ?? ""),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(protocol ? { protocol } : {}),
    ...(country ? { country } : {}),
  };
}

function isHeader(line: string): boolean {
  const cells = line.split(",").map((cell) => cell.trim().toLowerCase());
  return cells[0] === "host" && cells[1] === "port";
}

export function parseProxyImport(text: string): { proxies: ParsedProxy[]; errors: ImportIssue[] } {
  const lines = text.split(/\r?\n/);
  if (lines.length > MAX_IMPORT_LINES) {
    throw new Error(`Import accepts at most ${MAX_IMPORT_LINES} lines.`);
  }
  const proxies: ParsedProxy[] = [];
  const errors: ImportIssue[] = [];
  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw.trim();
    if (!line || line.startsWith("#") || isHeader(line)) {
      return;
    }
    try {
      proxies.push(line.includes(",") ? parseCsvLine(line) : parseEndpoint(line));
    } catch (error) {
      errors.push({
        line: lineNumber,
        message: error instanceof Error ? error.message : "Could not parse the line.",
      });
    }
  });
  return { proxies, errors };
}
