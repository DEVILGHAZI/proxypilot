export const UserRole = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
} as const;

export const UserStatus = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  DISABLED: "DISABLED",
} as const;

export const PlanTier = {
  FREE: "FREE",
  STARTER: "STARTER",
  PRO: "PRO",
  BUSINESS: "BUSINESS",
  ENTERPRISE: "ENTERPRISE",
} as const;

export const ProxyStatus = {
  HEALTHY: "HEALTHY",
  DEGRADED: "DEGRADED",
  QUARANTINED: "QUARANTINED",
  DISABLED: "DISABLED",
} as const;

export const RotationStrategy = {
  RANDOM: "RANDOM",
  ROUND_ROBIN: "ROUND_ROBIN",
  LEAST_LATENCY: "LEAST_LATENCY",
  WEIGHTED_HEALTH: "WEIGHTED_HEALTH",
  STICKY_SESSION: "STICKY_SESSION",
} as const;

export const ProxyProtocol = {
  HTTP: "HTTP",
  HTTPS: "HTTPS",
  SOCKS5: "SOCKS5",
} as const;

export const ProviderType = {
  DATACENTER: "DATACENTER",
  RESIDENTIAL: "RESIDENTIAL",
  ISP: "ISP",
  MOBILE: "MOBILE",
  CUSTOM: "CUSTOM",
} as const;

export const ProviderStatus = {
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
} as const;

export const PoolStatus = {
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
export type PlanTier = (typeof PlanTier)[keyof typeof PlanTier];
export type ProxyStatus = (typeof ProxyStatus)[keyof typeof ProxyStatus];
export type RotationStrategy = (typeof RotationStrategy)[keyof typeof RotationStrategy];
export type ProxyProtocol = (typeof ProxyProtocol)[keyof typeof ProxyProtocol];
export type ProviderType = (typeof ProviderType)[keyof typeof ProviderType];
export type ProviderStatus = (typeof ProviderStatus)[keyof typeof ProviderStatus];
export type PoolStatus = (typeof PoolStatus)[keyof typeof PoolStatus];
