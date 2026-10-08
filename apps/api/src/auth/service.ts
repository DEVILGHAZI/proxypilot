import { randomBytes } from "node:crypto";
import { getPrisma } from "@proxypilot/database";
import {
  SESSION_TTL_SECONDS,
  UserRole,
  UserStatus,
  canAssignRole,
  canCreateApiKey,
  canListAllApiKeys,
  canManageUser,
  canRevokeApiKey,
} from "@proxypilot/shared";
import type { UserRole as UserRoleName, UserStatus as UserStatusName } from "@proxypilot/shared";
import type { Prisma } from "@prisma/client";
import { ApiError } from "../http-error.js";
import { dummyPasswordHash, hashPassword, verifyPassword } from "./passwords.js";
import {
  apiKeyPrefix,
  createApiKeyMaterial,
  createSessionToken,
  hashApiKey,
  hashSessionToken,
  hashesMatch,
} from "./tokens.js";
import {
  assertLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
  type LoginCounter,
} from "./throttle.js";

const userInclude = {
  organization: true,
} as const;

type UserWithOrg = Prisma.UserGetPayload<{ include: typeof userInclude }>;

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: UserRoleName;
  status: UserStatusName;
  organization: {
    id: string;
    name: string;
    slug: string;
    plan: UserWithOrg["organization"]["plan"];
  };
};

export type PublicApiKey = {
  id: string;
  name: string;
  prefix: string;
  userId: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type AuthContext = {
  user: PublicUser;
  apiKeyId: string | null;
};

type RequestMeta = {
  ip: string | null;
  userAgent: string | null;
};

function toPublicUser(user: UserWithOrg): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    organization: {
      id: user.organization.id,
      name: user.organization.name,
      slug: user.organization.slug,
      plan: user.organization.plan,
    },
  };
}

function toPublicKey(key: {
  id: string;
  name: string;
  prefix: string;
  userId: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}): PublicApiKey {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    userId: key.userId,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
    expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
    revokedAt: key.revokedAt ? key.revokedAt.toISOString() : null,
  };
}

function slugBase(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : "org";
}

function isUniqueViolation(error: unknown, field: string): boolean {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") {
    return false;
  }
  const meta = "meta" in error ? error.meta : undefined;
  const target = meta && typeof meta === "object" && meta !== null && "target" in meta ? meta.target : undefined;
  const needle = field.toLowerCase();
  if (Array.isArray(target)) {
    return target.some((item) => typeof item === "string" && item.toLowerCase().includes(needle));
  }
  return typeof target === "string" && target.toLowerCase().includes(needle);
}

function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    userId: string | null;
    action: Prisma.AuditLogCreateInput["action"];
    resource: string;
    resourceId?: string;
    ip: string | null;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      ip: input.ip,
      metadata: input.metadata ?? {},
    },
  });
}

export async function registerAccount(
  sessionSecret: string,
  input: {
    email: string;
    password: string;
    name: string;
    organizationName: string;
    meta: RequestMeta;
  },
): Promise<{ user: PublicUser; sessionToken: string }> {
  const prisma = getPrisma();
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    throw new ApiError(409, "EMAIL_IN_USE", "An account with that email already exists.");
  }
  const passwordHash = await hashPassword(input.password);
  const sessionToken = createSessionToken();
  const tokenHash = hashSessionToken(sessionSecret, sessionToken);
  const base = slugBase(input.organizationName);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${randomBytes(3).toString("hex")}`;
    try {
      const user = await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            name: input.organizationName,
            slug,
          },
        });
        const created = await tx.user.create({
          data: {
            organizationId: organization.id,
            email: input.email,
            passwordHash,
            name: input.name,
            role: UserRole.OWNER,
            status: UserStatus.ACTIVE,
            lastLoginAt: new Date(),
          },
          include: userInclude,
        });
        await tx.authSession.create({
          data: {
            userId: created.id,
            tokenHash,
            expiresAt: sessionExpiry(),
            ip: input.meta.ip,
            userAgent: input.meta.userAgent,
          },
        });
        await writeAudit(tx, {
          organizationId: organization.id,
          userId: created.id,
          action: "LOGIN",
          resource: "session",
          ip: input.meta.ip,
          metadata: { email: created.email, event: "register" },
        });
        return created;
      });
      return { user: toPublicUser(user), sessionToken };
    } catch (error) {
      if (isUniqueViolation(error, "email")) {
        throw new ApiError(409, "EMAIL_IN_USE", "An account with that email already exists.");
      }
      if (isUniqueViolation(error, "slug") && attempt < 4) {
        continue;
      }
      throw error;
    }
  }

  throw new ApiError(409, "SLUG_IN_USE", "Could not reserve an organization slug.");
}

export async function loginAccount(
  counter: LoginCounter,
  sessionSecret: string,
  input: { email: string; password: string; meta: RequestMeta },
): Promise<{ user: PublicUser; sessionToken: string }> {
  const ip = input.meta.ip ?? "unknown";
  try {
    await assertLoginAllowed(counter, input.email, ip);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
  }

  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: userInclude,
  });
  const passwordOk = await verifyPassword(user?.passwordHash ?? (await dummyPasswordHash()), input.password);
  if (!user || !passwordOk) {
    try {
      await recordLoginFailure(counter, input.email, ip);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
    }
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw new ApiError(403, "ACCOUNT_DISABLED", "This account cannot sign in.");
  }

  try {
    await clearLoginFailures(counter, input.email, ip);
  } catch {
    // A Redis miss must not block a valid login.
  }

  const sessionToken = createSessionToken();
  const tokenHash = hashSessionToken(sessionSecret, sessionToken);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await tx.authSession.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: sessionExpiry(),
        ip: input.meta.ip,
        userAgent: input.meta.userAgent,
      },
    });
    await writeAudit(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "LOGIN",
      resource: "session",
      ip: input.meta.ip,
    });
  });

  return { user: toPublicUser(user), sessionToken };
}

export async function logoutSession(sessionSecret: string, token: string, meta: RequestMeta): Promise<void> {
  const prisma = getPrisma();
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashSessionToken(sessionSecret, token) },
    include: { user: true },
  });
  if (!session || session.revokedAt) {
    throw new ApiError(401, "UNAUTHENTICATED", "Sign in required.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    await writeAudit(tx, {
      organizationId: session.user.organizationId,
      userId: session.userId,
      action: "LOGOUT",
      resource: "session",
      resourceId: session.id,
      ip: meta.ip,
    });
  });
}

async function userFromSession(sessionSecret: string, token: string): Promise<AuthContext | null> {
  const prisma = getPrisma();
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashSessionToken(sessionSecret, token) },
    include: { user: { include: userInclude } },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  if (session.user.status !== UserStatus.ACTIVE) {
    return null;
  }
  return { user: toPublicUser(session.user), apiKeyId: null };
}

async function userFromApiKey(secret: string): Promise<AuthContext | null> {
  const prefix = apiKeyPrefix(secret);
  if (!prefix) {
    return null;
  }
  const prisma = getPrisma();
  const candidates = await prisma.apiKey.findMany({
    where: { prefix, revokedAt: null },
    include: { user: { include: userInclude } },
  });
  const keyHash = hashApiKey(secret);
  const match = candidates.find((candidate) => hashesMatch(candidate.keyHash, keyHash));
  if (!match || (match.expiresAt && match.expiresAt.getTime() <= Date.now())) {
    return null;
  }
  if (match.user.status !== UserStatus.ACTIVE) {
    return null;
  }
  await prisma.apiKey.update({
    where: { id: match.id },
    data: { lastUsedAt: new Date() },
  });
  return { user: toPublicUser(match.user), apiKeyId: match.id };
}

export async function authenticate(input: {
  sessionSecret: string;
  sessionToken: string | null;
  bearer: string | null;
}): Promise<AuthContext | null> {
  if (input.bearer) {
    return userFromApiKey(input.bearer);
  }
  if (input.sessionToken) {
    return userFromSession(input.sessionSecret, input.sessionToken);
  }
  return null;
}

export async function createOrgUser(
  actor: PublicUser,
  input: { email: string; password: string; name: string; role: UserRoleName },
  meta: RequestMeta,
): Promise<PublicUser> {
  if (!canAssignRole(actor.role, input.role)) {
    throw new ApiError(403, "FORBIDDEN", "You cannot assign that role.");
  }
  const prisma = getPrisma();
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    throw new ApiError(409, "EMAIL_IN_USE", "An account with that email already exists.");
  }
  const passwordHash = await hashPassword(input.password);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: actor.organization.id,
          email: input.email,
          passwordHash,
          name: input.name,
          role: input.role,
          status: UserStatus.ACTIVE,
        },
        include: userInclude,
      });
      await writeAudit(tx, {
        organizationId: actor.organization.id,
        userId: actor.id,
        action: "SETTINGS_CHANGED",
        resource: "user",
        resourceId: user.id,
        ip: meta.ip,
        metadata: { role: input.role },
      });
      return user;
    });
    return toPublicUser(created);
  } catch (error) {
    if (isUniqueViolation(error, "email")) {
      throw new ApiError(409, "EMAIL_IN_USE", "An account with that email already exists.");
    }
    throw error;
  }
}

export async function listOrgUsers(actor: PublicUser): Promise<PublicUser[]> {
  const users = await getPrisma().user.findMany({
    where: { organizationId: actor.organization.id },
    include: userInclude,
    orderBy: { createdAt: "asc" },
  });
  return users.map(toPublicUser);
}

export async function updateOrgUser(
  actor: PublicUser,
  userId: string,
  input: { role?: UserRoleName; status?: UserStatusName },
  meta: RequestMeta,
): Promise<PublicUser> {
  if (actor.id === userId) {
    throw new ApiError(403, "FORBIDDEN", "You cannot change your own access.");
  }
  const prisma = getPrisma();
  const target = await prisma.user.findFirst({
    where: { id: userId, organizationId: actor.organization.id },
    include: userInclude,
  });
  if (!target) {
    throw new ApiError(404, "NOT_FOUND", "User not found.");
  }
  if (!canManageUser(actor.role, target.role)) {
    throw new ApiError(403, "FORBIDDEN", "You cannot change that user.");
  }
  const nextRole = input.role ?? target.role;
  const nextStatus = input.status ?? target.status;
  if (input.role && !canAssignRole(actor.role, input.role)) {
    throw new ApiError(403, "FORBIDDEN", "You cannot assign that role.");
  }
  if (target.role === UserRole.OWNER && target.status === UserStatus.ACTIVE) {
    const remainsOwner = nextRole === UserRole.OWNER && nextStatus === UserStatus.ACTIVE;
    if (!remainsOwner) {
      const others = await prisma.user.count({
        where: {
          organizationId: actor.organization.id,
          role: UserRole.OWNER,
          status: UserStatus.ACTIVE,
          id: { not: target.id },
        },
      });
      if (others === 0) {
        throw new ApiError(409, "LAST_OWNER", "The organization needs an active owner.");
      }
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: target.id },
      data: { role: nextRole, status: nextStatus },
      include: userInclude,
    });
    await writeAudit(tx, {
      organizationId: actor.organization.id,
      userId: actor.id,
      action: "SETTINGS_CHANGED",
      resource: "user",
      resourceId: user.id,
      ip: meta.ip,
      metadata: { role: nextRole, status: nextStatus },
    });
    return user;
  });
  return toPublicUser(updated);
}

export async function createApiKey(
  actor: PublicUser,
  input: { name: string; expiresAt: Date | null },
  meta: RequestMeta,
): Promise<{ key: PublicApiKey; secret: string }> {
  if (!canCreateApiKey(actor.role)) {
    throw new ApiError(403, "FORBIDDEN", "You cannot create API keys.");
  }
  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(400, "VALIDATION_ERROR", "expiresAt must be in the future.");
  }
  const material = createApiKeyMaterial();
  const prisma = getPrisma();
  const created = await prisma.$transaction(async (tx) => {
    const key = await tx.apiKey.create({
      data: {
        organizationId: actor.organization.id,
        userId: actor.id,
        name: input.name,
        keyHash: material.keyHash,
        prefix: material.prefix,
        expiresAt: input.expiresAt,
      },
    });
    await writeAudit(tx, {
      organizationId: actor.organization.id,
      userId: actor.id,
      action: "API_KEY_CREATED",
      resource: "api_key",
      resourceId: key.id,
      ip: meta.ip,
      metadata: { name: key.name, prefix: key.prefix },
    });
    return key;
  });
  return { key: toPublicKey(created), secret: material.secret };
}

export async function listApiKeys(actor: PublicUser): Promise<PublicApiKey[]> {
  const keys = await getPrisma().apiKey.findMany({
    where: {
      organizationId: actor.organization.id,
      ...(canListAllApiKeys(actor.role) ? {} : { userId: actor.id }),
    },
    orderBy: { createdAt: "desc" },
  });
  return keys.map(toPublicKey);
}

export async function revokeApiKey(actor: PublicUser, keyId: string, meta: RequestMeta): Promise<PublicApiKey> {
  const prisma = getPrisma();
  const key = await prisma.apiKey.findFirst({
    where: { id: keyId, organizationId: actor.organization.id },
  });
  if (!key) {
    throw new ApiError(404, "NOT_FOUND", "API key not found.");
  }
  if (!canRevokeApiKey(actor.role, key.userId === actor.id)) {
    throw new ApiError(403, "FORBIDDEN", "You cannot revoke that API key.");
  }
  if (key.revokedAt) {
    return toPublicKey(key);
  }
  const revoked = await prisma.$transaction(async (tx) => {
    const updated = await tx.apiKey.update({
      where: { id: key.id },
      data: { revokedAt: new Date() },
    });
    await writeAudit(tx, {
      organizationId: actor.organization.id,
      userId: actor.id,
      action: "API_KEY_REVOKED",
      resource: "api_key",
      resourceId: key.id,
      ip: meta.ip,
      metadata: { prefix: key.prefix },
    });
    return updated;
  });
  return toPublicKey(revoked);
}
