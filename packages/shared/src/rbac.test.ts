import { describe, expect, it } from "vitest";
import { UserRole } from "./enums.js";
import {
  canAssignRole,
  canCreateApiKey,
  canDeleteInventory,
  canListAllApiKeys,
  canManageUser,
  canRevokeApiKey,
  canWriteInventory,
  roleAtLeast,
} from "./rbac.js";

describe("rbac", () => {
  it("orders roles from viewer to owner", () => {
    expect(roleAtLeast(UserRole.OWNER, UserRole.ADMIN)).toBe(true);
    expect(roleAtLeast(UserRole.MEMBER, UserRole.ADMIN)).toBe(false);
    expect(roleAtLeast(UserRole.VIEWER, UserRole.VIEWER)).toBe(true);
  });

  it("lets owners assign any role and admins assign member or viewer", () => {
    expect(canAssignRole(UserRole.OWNER, UserRole.OWNER)).toBe(true);
    expect(canAssignRole(UserRole.ADMIN, UserRole.MEMBER)).toBe(true);
    expect(canAssignRole(UserRole.ADMIN, UserRole.ADMIN)).toBe(false);
    expect(canAssignRole(UserRole.MEMBER, UserRole.VIEWER)).toBe(false);
  });

  it("stops admins from managing owners", () => {
    expect(canManageUser(UserRole.ADMIN, UserRole.MEMBER)).toBe(true);
    expect(canManageUser(UserRole.ADMIN, UserRole.OWNER)).toBe(false);
    expect(canManageUser(UserRole.VIEWER, UserRole.VIEWER)).toBe(false);
  });

  it("limits api key writes to member and above, and keeps viewer keys read-scoped", () => {
    expect(canCreateApiKey(UserRole.VIEWER)).toBe(false);
    expect(canCreateApiKey(UserRole.MEMBER)).toBe(true);
    expect(canListAllApiKeys(UserRole.ADMIN)).toBe(true);
    expect(canListAllApiKeys(UserRole.MEMBER)).toBe(false);
    expect(canRevokeApiKey(UserRole.MEMBER, true)).toBe(true);
    expect(canRevokeApiKey(UserRole.MEMBER, false)).toBe(false);
    expect(canRevokeApiKey(UserRole.VIEWER, true)).toBe(false);
    expect(canRevokeApiKey(UserRole.OWNER, false)).toBe(true);
  });

  it("lets members edit inventory and reserves deletes for admins", () => {
    expect(canWriteInventory(UserRole.VIEWER)).toBe(false);
    expect(canWriteInventory(UserRole.MEMBER)).toBe(true);
    expect(canDeleteInventory(UserRole.MEMBER)).toBe(false);
    expect(canDeleteInventory(UserRole.ADMIN)).toBe(true);
  });
});
