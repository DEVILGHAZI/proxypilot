import { UserRole } from "./enums.js";
import type { UserRole as UserRoleName } from "./enums.js";

const ROLE_RANK: Record<UserRoleName, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function roleAtLeast(role: UserRoleName, minimum: UserRoleName): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function canAssignRole(actor: UserRoleName, nextRole: UserRoleName): boolean {
  if (actor === UserRole.OWNER) {
    return true;
  }
  if (actor === UserRole.ADMIN) {
    return nextRole === UserRole.MEMBER || nextRole === UserRole.VIEWER;
  }
  return false;
}

export function canManageUser(actor: UserRoleName, targetRole: UserRoleName): boolean {
  if (actor === UserRole.OWNER) {
    return true;
  }
  if (actor === UserRole.ADMIN) {
    return targetRole === UserRole.MEMBER || targetRole === UserRole.VIEWER;
  }
  return false;
}

export function canCreateApiKey(role: UserRoleName): boolean {
  return roleAtLeast(role, UserRole.MEMBER);
}

export function canListAllApiKeys(role: UserRoleName): boolean {
  return role === UserRole.OWNER || role === UserRole.ADMIN;
}

export function canWriteInventory(role: UserRoleName): boolean {
  return roleAtLeast(role, UserRole.MEMBER);
}

export function canDeleteInventory(role: UserRoleName): boolean {
  return roleAtLeast(role, UserRole.ADMIN);
}

export function canRevokeApiKey(actor: UserRoleName, ownsKey: boolean): boolean {
  if (actor === UserRole.OWNER || actor === UserRole.ADMIN) {
    return true;
  }
  return actor === UserRole.MEMBER && ownsKey;
}
