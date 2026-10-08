import { describe, expect, it } from "vitest";
import { API_KEY_PREFIX } from "@proxypilot/shared";
import { apiKeyPrefix, createApiKeyMaterial, hashApiKey, hashesMatch } from "./tokens.js";

describe("api key material", () => {
  it("returns a prefixed secret once and stores only a hash", () => {
    const material = createApiKeyMaterial();
    expect(material.secret.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(material.prefix).toBe(material.secret.slice(0, API_KEY_PREFIX.length + 8));
    expect(material.keyHash).toBe(hashApiKey(material.secret));
    expect(material.keyHash).not.toContain(material.secret);
    expect(apiKeyPrefix(material.secret)).toBe(material.prefix);
    expect(apiKeyPrefix("not-a-key")).toBeNull();
    expect(hashesMatch(material.keyHash, hashApiKey(material.secret))).toBe(true);
    expect(hashesMatch(material.keyHash, hashApiKey(`${material.secret}x`))).toBe(false);
  });
});
