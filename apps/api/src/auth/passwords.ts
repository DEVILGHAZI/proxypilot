import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

const ARGON_OPTIONS = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const dummyHash = hash(randomBytes(32).toString("base64url"), ARGON_OPTIONS);

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

export function dummyPasswordHash(): Promise<string> {
  return dummyHash;
}
