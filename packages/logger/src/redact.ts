const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "passwordhash",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "apikey",
  "jwt",
  "sessionsecret",
  "jwtsecret",
  "encryptionkey",
  "username",
  "proxyusername",
  "proxypassword",
  "usernameencrypted",
  "passwordencrypted",
  "credentials",
  "credential",
  "keyhash",
  "tokenhash",
  "sessiontoken",
]);

const USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi;
const BEARER = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const API_KEY = /\bpp_(live|test)_[A-Za-z0-9]+\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const ASSIGNED_SECRET =
  /\b(password|passwd|secret|token|api[_-]?key|jwt|authorization)\s*[:=]\s*([^\s&"',]+)/gi;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

export function redactString(input: string): string {
  return input
    .replace(USERINFO, `$1${REDACTED}:${REDACTED}@`)
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(API_KEY, "pp_$1_[REDACTED]")
    .replace(JWT, REDACTED)
    .replace(ASSIGNED_SECRET, "$1=[REDACTED]");
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }
  if (value instanceof Date || value instanceof RegExp || Buffer.isBuffer(value)) {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, seen));
  }
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, seen);
  }
  return output;
}

export function redactSecrets<T>(value: T): T {
  return redactValue(value, new WeakSet()) as T;
}
