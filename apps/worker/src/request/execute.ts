import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  MAX_REDIRECTS,
  inspectTargetUrl,
  isBlockedAddress,
  isRetryableHttpStatus,
} from "@proxypilot/shared";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { proxyEndpoint } from "../health/endpoint.js";

export class TargetBlockedError extends Error {
  constructor() {
    super("TARGET_BLOCKED");
    this.name = "TargetBlockedError";
  }
}

export type ForwardResult = {
  httpStatus: number | null;
  latencyMs: number;
  errorCode: string | null;
  retryable: boolean;
};

function nodeCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  if (error instanceof Error && "cause" in error) {
    return nodeCode(error.cause);
  }
  return undefined;
}

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return true;
  }
  const code = nodeCode(error);
  return code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT";
}

function connectionCode(error: unknown): string {
  switch (nodeCode(error)) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "DNS";
    case "ECONNREFUSED":
      return "CONNECTION_REFUSED";
    case "ECONNRESET":
      return "CONNECTION_RESET";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "HOST_UNREACHABLE";
    default:
      return "CONNECTION_FAILED";
  }
}

export async function resolvePublicTarget(
  value: string,
  options: {
    allowHosts?: ReadonlySet<string>;
    lookupHost?: (hostname: string) => Promise<Array<{ address: string }>>;
  } = {},
): Promise<URL> {
  const inspected = inspectTargetUrl(value, options.allowHosts);
  if (!inspected.ok) {
    throw new TargetBlockedError();
  }
  const host = inspected.url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (options.allowHosts?.has(host)) {
    return inspected.url;
  }
  if (isBlockedAddress(host)) {
    throw new TargetBlockedError();
  }
  if (isIP(host) !== 0) {
    return inspected.url;
  }
  let records: Array<{ address: string }>;
  try {
    records = await (options.lookupHost ?? ((hostname: string) => lookup(hostname, { all: true, verbatim: true })))(host);
  } catch {
    throw new Error("DNS");
  }
  if (records.length === 0 || records.some((record) => isBlockedAddress(record.address))) {
    throw new TargetBlockedError();
  }
  return inspected.url;
}

const SWITCH_TO_GET = new Set([301, 302, 303]);

export async function forwardThroughProxy(input: {
  protocol: "HTTP" | "HTTPS" | "SOCKS5";
  host: string;
  port: number;
  username?: string;
  password?: string;
  url: string;
  method: string;
  body: string | null;
  timeoutMs: number;
  allowHosts?: ReadonlySet<string>;
  resolveTarget?: (value: string) => Promise<URL>;
}): Promise<ForwardResult> {
  const started = Date.now();
  const agent = new ProxyAgent(proxyEndpoint(input));
  const resolveTarget =
    input.resolveTarget ?? ((url: string) => resolvePublicTarget(url, { allowHosts: input.allowHosts }));
  let currentUrl = input.url;
  let method = input.method;
  let body = input.body;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let target: URL;
      try {
        target = await resolveTarget(currentUrl);
      } catch (error) {
        const latencyMs = Date.now() - started;
        if (error instanceof TargetBlockedError) {
          return { httpStatus: null, latencyMs, errorCode: "TARGET_BLOCKED", retryable: false };
        }
        return { httpStatus: null, latencyMs, errorCode: "DNS", retryable: true };
      }
      const response = await undiciFetch(target, {
        dispatcher: agent,
        method,
        body: body && method !== "GET" && method !== "HEAD" ? body : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(input.timeoutMs),
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location && hop < MAX_REDIRECTS) {
        await response.body?.cancel().catch(() => undefined);
        currentUrl = new URL(location, target).toString();
        if (SWITCH_TO_GET.has(response.status)) {
          method = "GET";
          body = null;
        }
        continue;
      }
      await response.body?.cancel().catch(() => undefined);
      const latencyMs = Date.now() - started;
      if (response.status === 407) {
        return { httpStatus: 407, latencyMs, errorCode: "PROXY_AUTH", retryable: true };
      }
      if (isRetryableHttpStatus(response.status)) {
        const errorCode = response.status === 429 ? "HTTP_429" : response.status >= 500 ? "HTTP_5XX" : "HTTP_RETRY";
        return { httpStatus: response.status, latencyMs, errorCode, retryable: true };
      }
      return { httpStatus: response.status, latencyMs, errorCode: null, retryable: false };
    }
    return { httpStatus: null, latencyMs: Date.now() - started, errorCode: "REDIRECTS", retryable: false };
  } catch (error) {
    const latencyMs = Date.now() - started;
    if (isTimeout(error)) {
      return { httpStatus: null, latencyMs, errorCode: "TIMEOUT", retryable: true };
    }
    return { httpStatus: null, latencyMs, errorCode: connectionCode(error), retryable: true };
  } finally {
    await agent.close();
  }
}
