import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { API_KEY_PREFIX } from "@proxypilot/shared";

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(sessionSecret: string, token: string): string {
  return createHash("sha256").update(sessionSecret).update(".").update(token).digest("hex");
}

export function createApiKeyMaterial(): { secret: string; prefix: string; keyHash: string } {
  const body = randomBytes(32).toString("base64url");
  const secret = `${API_KEY_PREFIX}${body}`;
  return {
    secret,
    prefix: secret.slice(0, API_KEY_PREFIX.length + 8),
    keyHash: hashApiKey(secret),
  };
}

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function apiKeyPrefix(secret: string): string | null {
  if (!secret.startsWith(API_KEY_PREFIX) || secret.length < API_KEY_PREFIX.length + 8) {
    return null;
  }
  return secret.slice(0, API_KEY_PREFIX.length + 8);
}

export function hashesMatch(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  if (left.length === 0 || left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
