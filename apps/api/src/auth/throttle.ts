import { createHash } from "node:crypto";
import { LOGIN_FAILURE_LIMIT, LOGIN_FAILURE_WINDOW_SECONDS } from "@proxypilot/shared";
import { ApiError } from "../http-error.js";

export type LoginCounter = {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  del(key: string): Promise<number>;
};

function failureKey(email: string, ip: string): string {
  const digest = createHash("sha256").update(email).update("|").update(ip).digest("hex");
  return `auth:login:fail:${digest}`;
}

export async function assertLoginAllowed(counter: LoginCounter, email: string, ip: string): Promise<void> {
  const current = Number((await counter.get(failureKey(email, ip))) ?? "0");
  if (Number.isFinite(current) && current >= LOGIN_FAILURE_LIMIT) {
    throw new ApiError(429, "RATE_LIMITED", "Too many login attempts. Try again later.");
  }
}

export async function recordLoginFailure(counter: LoginCounter, email: string, ip: string): Promise<void> {
  const key = failureKey(email, ip);
  const count = await counter.incr(key);
  if (count === 1) {
    await counter.expire(key, LOGIN_FAILURE_WINDOW_SECONDS);
  }
}

export async function clearLoginFailures(counter: LoginCounter, email: string, ip: string): Promise<void> {
  await counter.del(failureKey(email, ip));
}
