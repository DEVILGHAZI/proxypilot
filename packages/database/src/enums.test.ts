import {
  Plan,
  PoolStatus,
  ProviderStatus,
  ProviderType,
  ProxyProtocol,
  ProxyStatus,
  RotationStrategy,
  UserRole,
  UserStatus,
} from "@prisma/client";
import {
  PlanTier,
  PoolStatus as SharedPoolStatus,
  ProviderStatus as SharedProviderStatus,
  ProviderType as SharedProviderType,
  ProxyProtocol as SharedProxyProtocol,
  ProxyStatus as SharedProxyStatus,
  RotationStrategy as SharedRotationStrategy,
  UserRole as SharedUserRole,
  UserStatus as SharedUserStatus,
} from "@proxypilot/shared";
import { describe, expect, it } from "vitest";

function values(record: Record<string, string>): string[] {
  return Object.values(record).sort();
}

describe("shared enums match Prisma", () => {
  it("keeps the foundation enums aligned with the database", () => {
    expect(values(SharedUserRole)).toEqual(values(UserRole));
    expect(values(SharedUserStatus)).toEqual(values(UserStatus));
    expect(values(PlanTier)).toEqual(values(Plan));
    expect(values(SharedProxyProtocol)).toEqual(values(ProxyProtocol));
    expect(values(SharedProxyStatus)).toEqual(values(ProxyStatus));
    expect(values(SharedRotationStrategy)).toEqual(values(RotationStrategy));
    expect(values(SharedProviderType)).toEqual(values(ProviderType));
    expect(values(SharedProviderStatus)).toEqual(values(ProviderStatus));
    expect(values(SharedPoolStatus)).toEqual(values(PoolStatus));
  });
});
