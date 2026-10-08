import { ProxyAgent, fetch as undiciFetch } from "undici";
import type { HealthOutcome } from "@proxypilot/shared";
import { proxyEndpoint, sanitizeProbeMessage } from "./endpoint.js";

export type ProbeTarget = {
  protocol: "HTTP" | "HTTPS" | "SOCKS5";
  host: string;
  port: number;
  username?: string;
  password?: string;
  targetUrl: string;
  timeoutMs: number;
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
  const code = nodeCode(error);
  switch (code) {
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

export async function probeProxy(input: ProbeTarget): Promise<HealthOutcome> {
  const started = Date.now();
  const agent = new ProxyAgent(proxyEndpoint(input));
  try {
    const response = await undiciFetch(input.targetUrl, {
      dispatcher: agent,
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    const latencyMs = Date.now() - started;
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 407) {
      return {
        kind: "connection_failure",
        latencyMs,
        httpStatus: 407,
        errorCode: "PROXY_AUTH",
        errorMessage: "Proxy authentication failed.",
      };
    }
    if (response.status >= 500) {
      return {
        kind: "http_5xx",
        latencyMs,
        httpStatus: response.status,
        errorCode: "HTTP_5XX",
        errorMessage: `Target responded with HTTP ${response.status}.`,
      };
    }
    return { kind: "success", latencyMs, httpStatus: response.status };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message = sanitizeProbeMessage(error instanceof Error ? error.message : "Proxy probe failed.");
    if (isTimeout(error)) {
      return { kind: "timeout", latencyMs, errorCode: "TIMEOUT", errorMessage: message || "Health check timed out." };
    }
    return {
      kind: "connection_failure",
      latencyMs,
      errorCode: connectionCode(error),
      errorMessage: message || "Proxy connection failed.",
    };
  } finally {
    await agent.close();
  }
}
