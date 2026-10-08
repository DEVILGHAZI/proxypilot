import { z } from "zod";

const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
const nodeEnvs = ["development", "test", "production"] as const;

function envInt(min: number, max: number, fallback: number) {
  return z
    .union([z.string(), z.number(), z.undefined()])
    .transform((value) => {
      if (value === undefined || value === "") {
        return fallback;
      }
      return typeof value === "number" ? value : Number(value);
    })
    .pipe(z.number().int().min(min).max(max));
}

function envString(fallback: string) {
  return z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === "" ? fallback : value));
}

export const envSchema = z
  .object({
    NODE_ENV: z.enum(nodeEnvs).default("development"),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z
      .string()
      .min(1)
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "redis:" || url.protocol === "rediss:";
        } catch {
          return false;
        }
      }, "REDIS_URL must be a redis:// or rediss:// URL"),
    SESSION_SECRET: z.string().min(32),
    JWT_SECRET: z.string().min(32),
    ENCRYPTION_KEY: z.string().min(1),
    API_BASE_URL: envString("http://localhost:4000").pipe(z.string().url()),
    WEB_ORIGIN: envString("http://localhost:3000").pipe(z.string().url()),
    API_HOST: envString("0.0.0.0"),
    API_PORT: envInt(1, 65535, 4000),
    LOG_LEVEL: z.enum(logLevels).default("info"),
    HEALTH_CHECK_CONCURRENCY: envInt(1, 200, 20),
    REQUEST_CONCURRENCY: envInt(1, 500, 50),
    DEFAULT_REQUEST_TIMEOUT: envInt(1, 300_000, 30_000),
    DEFAULT_MAX_RETRIES: envInt(0, 10, 3),
    ORG_REQUESTS_PER_SECOND: envInt(1, 100_000, 100),
    USER_REQUESTS_PER_SECOND: envInt(1, 100_000, 30),
    API_KEY_REQUESTS_PER_SECOND: envInt(1, 100_000, 30),
    DOMAIN_REQUESTS_PER_SECOND: envInt(1, 100_000, 20),
    SSRF_ALLOW_HOSTS: envString(""),
    HEALTH_CHECK_URL: envString("https://example.com/").pipe(z.string().url()),
    HEALTH_CHECK_INTERVAL_SECONDS: envInt(10, 86_400, 60),
    HEALTH_CHECK_TIMEOUT_MS: envInt(500, 60_000, 5_000),
    HEALTH_COOLDOWN_SECONDS: envInt(1, 86_400, 60),
    HEALTH_MAX_COOLDOWN_SECONDS: envInt(1, 604_800, 3_600),
    HEALTHY_SCORE_MIN: envInt(1, 100, 70),
    DEGRADED_SCORE_MIN: envInt(0, 99, 40),
  })
  .superRefine((value, ctx) => {
    const key = Buffer.from(value.ENCRYPTION_KEY, "base64");
    if (key.length !== 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ENCRYPTION_KEY"],
        message: "ENCRYPTION_KEY must be 32 bytes encoded as base64",
      });
    }
    let target: URL;
    try {
      target = new URL(value.HEALTH_CHECK_URL);
    } catch {
      return;
    }
    if ((target.protocol !== "http:" && target.protocol !== "https:") || target.username || target.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["HEALTH_CHECK_URL"],
        message: "HEALTH_CHECK_URL must be an http(s) URL without credentials",
      });
    }
    if (value.HEALTH_MAX_COOLDOWN_SECONDS < value.HEALTH_COOLDOWN_SECONDS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["HEALTH_MAX_COOLDOWN_SECONDS"],
        message: "HEALTH_MAX_COOLDOWN_SECONDS must be at least HEALTH_COOLDOWN_SECONDS",
      });
    }
    const allowHosts = value.SSRF_ALLOW_HOSTS.split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);
    if (allowHosts.length > 32 || allowHosts.some((host) => !/^[a-z0-9.:_-]+$/.test(host))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SSRF_ALLOW_HOSTS"],
        message: "SSRF_ALLOW_HOSTS must be a comma-separated list of hostnames or IP addresses",
      });
    }
    if (value.HEALTHY_SCORE_MIN <= value.DEGRADED_SCORE_MIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["HEALTHY_SCORE_MIN"],
        message: "HEALTHY_SCORE_MIN must be greater than DEGRADED_SCORE_MIN",
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  return result.data;
}

let cached: AppConfig | undefined;

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  if (source === process.env && cached) {
    return cached;
  }
  const config = parseEnv(source);
  if (source === process.env) {
    cached = config;
  }
  return config;
}

export function resetConfigCache(): void {
  cached = undefined;
}
