export type ServiceState = "up" | "down" | "unknown";

export type SystemStatus = {
  api: ServiceState;
  postgres: ServiceState;
  redis: ServiceState;
  worker: ServiceState;
  requestId: string | null;
  checkedAt: string;
};

type ReadyPayload = {
  success?: boolean;
  requestId?: string;
  checks?: {
    postgres?: ServiceState;
    redis?: ServiceState;
    worker?: ServiceState;
  };
  data?: {
    checks?: {
      postgres?: ServiceState;
      redis?: ServiceState;
      worker?: ServiceState;
    };
  };
};

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

export async function loadSystemStatus(): Promise<SystemStatus> {
  const checkedAt = new Date().toISOString();
  const base = apiBaseUrl();
  try {
    const health = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (!health.ok) {
      return {
        api: "down",
        postgres: "unknown",
        redis: "unknown",
        worker: "unknown",
        requestId: health.headers.get("x-request-id"),
        checkedAt,
      };
    }

    const ready = await fetch(`${base}/ready`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    const body = (await ready.json()) as ReadyPayload;
    const checks = body.data?.checks ?? body.checks;
    return {
      api: "up",
      postgres: checks?.postgres ?? "unknown",
      redis: checks?.redis ?? "unknown",
      worker: checks?.worker ?? "unknown",
      requestId: body.requestId ?? ready.headers.get("x-request-id"),
      checkedAt,
    };
  } catch {
    return {
      api: "down",
      postgres: "unknown",
      redis: "unknown",
      worker: "unknown",
      requestId: null,
      checkedAt,
    };
  }
}
