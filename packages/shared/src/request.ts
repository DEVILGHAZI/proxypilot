import { BlockList, isIP } from "node:net";

export const REQUEST_JOB = "execute";
export const RETRY_JOB = "retry";
export const USAGE_JOB = "usage";
export const CLEANUP_JOB = "sweep";

export const DEFAULT_BACKOFF_BASE_MS = 200;
export const DEFAULT_BACKOFF_CAP_MS = 8_000;
export const MAX_REDIRECTS = 3;
export const MAX_REQUEST_BODY_CHARS = 16_384;
export const REQUEST_URL_MAX_LENGTH = 2_048;

export const REQUEST_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;
export type RequestMethod = (typeof REQUEST_METHODS)[number];

export function requestJobId(requestId: string): string {
  return `request-${requestId}`;
}

export function retryJobId(requestId: string, attempt: number): string {
  return `retry-${requestId}-${attempt}`;
}

export function backoffDelayMs(
  retryIndex: number,
  baseMs = DEFAULT_BACKOFF_BASE_MS,
  capMs = DEFAULT_BACKOFF_CAP_MS,
): number {
  const exponent = Math.min(Math.max(retryIndex, 0), 8);
  return Math.min(capMs, baseMs * 2 ** exponent);
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function isRequestMethod(value: string): value is RequestMethod {
  return (REQUEST_METHODS as readonly string[]).includes(value);
}

const blockedAddresses = new BlockList();
blockedAddresses.addSubnet("0.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("10.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("100.64.0.0", 10, "ipv4");
blockedAddresses.addSubnet("127.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("169.254.0.0", 16, "ipv4");
blockedAddresses.addSubnet("172.16.0.0", 12, "ipv4");
blockedAddresses.addSubnet("192.0.0.0", 24, "ipv4");
blockedAddresses.addSubnet("192.0.2.0", 24, "ipv4");
blockedAddresses.addSubnet("192.168.0.0", 16, "ipv4");
blockedAddresses.addSubnet("198.18.0.0", 15, "ipv4");
blockedAddresses.addSubnet("198.51.100.0", 24, "ipv4");
blockedAddresses.addSubnet("203.0.113.0", 24, "ipv4");
blockedAddresses.addSubnet("224.0.0.0", 4, "ipv4");
blockedAddresses.addSubnet("240.0.0.0", 4, "ipv4");
blockedAddresses.addAddress("::", "ipv6");
blockedAddresses.addAddress("::1", "ipv6");
blockedAddresses.addSubnet("fc00::", 7, "ipv6");
blockedAddresses.addSubnet("fe80::", 10, "ipv6");
blockedAddresses.addSubnet("ff00::", 8, "ipv6");

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
]);

export type TargetVerdict = { ok: true; url: URL } | { ok: false };

export function parseAllowHosts(value: string): ReadonlySet<string> {
  return new Set(
    value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0),
  );
}

function isAlternateAddress(host: string): boolean {
  if (/^0x[0-9a-f]+$/i.test(host) || /^\d+$/.test(host)) {
    return true;
  }
  const labels = host.split(".");
  if (labels.length < 1 || labels.length > 4) {
    return false;
  }
  if (!labels.every((label) => /^(0x[0-9a-f]+|\d+)$/i.test(label))) {
    return false;
  }
  const canonical =
    labels.length === 4 &&
    labels.every((label) => /^\d{1,3}$/.test(label) && !(label.length > 1 && label.startsWith("0")) && Number(label) <= 255);
  return !canonical;
}

function hostName(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function blockedHostName(host: string): boolean {
  if (BLOCKED_HOSTS.has(host)) {
    return true;
  }
  return (
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localdomain")
  );
}

export function isBlockedAddress(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  const mapped = bare.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1]) {
    return isBlockedAddress(mapped[1]);
  }
  if (bare.startsWith("::ffff:")) {
    return true;
  }
  const family = isIP(bare);
  if (family === 0) {
    return false;
  }
  return blockedAddresses.check(bare, family === 4 ? "ipv4" : "ipv6");
}

export function inspectTargetUrl(value: string, allowHosts?: ReadonlySet<string>): TargetVerdict {
  if (value.length === 0 || value.length > REQUEST_URL_MAX_LENGTH) {
    return { ok: false };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false };
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    return { ok: false };
  }
  const host = hostName(url);
  if (!host || !/^[a-z0-9.:_-]+$/.test(host)) {
    return { ok: false };
  }
  if (allowHosts?.has(host)) {
    return { ok: true, url };
  }
  if (blockedHostName(host) || isAlternateAddress(host)) {
    return { ok: false };
  }
  if (!host.includes(".") && !host.includes(":") && isIP(host) === 0) {
    return { ok: false };
  }
  if (isBlockedAddress(host)) {
    return { ok: false };
  }
  return { ok: true, url };
}

export function rateWindowKey(
  scope: "org" | "user" | "key" | "domain" | "policy",
  id: string,
  now = Date.now(),
): string {
  return `rl:${scope}:${id}:${Math.floor(now / 1000)}`;
}

export function usagePeriodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
