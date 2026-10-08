import pino, { type Logger, type LoggerOptions } from "pino";
import { redactSecrets } from "./redact.js";

export const REDACT_PATHS = [
  "password",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.set-cookie",
  "req.headers.proxy-authorization",
  "*.password",
  "*.passwordHash",
  "*.token",
  "*.apiKey",
  "*.authorization",
  "*.cookie",
  "*.jwt",
  "*.encryptionKey",
  "*.sessionSecret",
];

export function createLogger(options: { name: string; level: string }): Logger {
  const loggerOptions: LoggerOptions = {
    name: options.name,
    level: options.level,
    redact: {
      paths: REDACT_PATHS,
      censor: "[REDACTED]",
    },
    formatters: {
      log(object) {
        return redactSecrets(object);
      },
    },
  };
  return pino(loggerOptions);
}
