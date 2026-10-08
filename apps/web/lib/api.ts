export type ApiFailure = {
  success: false;
  error?: { code?: string; message?: string };
};

export type ApiSuccess<T> = {
  success: true;
  data: T;
};

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: ApiSuccess<T> | ApiFailure }> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  const body = (await response.json()) as ApiSuccess<T> | ApiFailure;
  return { status: response.status, body };
}

export function errorMessage(body: ApiSuccess<unknown> | ApiFailure, fallback: string): string {
  if (body.success) {
    return fallback;
  }
  return body.error?.message ?? fallback;
}
