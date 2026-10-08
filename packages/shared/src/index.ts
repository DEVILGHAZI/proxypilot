export const PRODUCT_NAME = "ProxyPilot";
export const PRODUCT_TAGLINE = "Intelligent Proxy Infrastructure for Reliable Web Requests.";

export { apiFailure, apiSuccess } from "./errors.js";
export type { ApiErrorBody, ApiFailure, ApiSuccess } from "./errors.js";
export {
  API_KEY_PREFIX,
  LOGIN_FAILURE_LIMIT,
  LOGIN_FAILURE_WINDOW_SECONDS,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "./session.js";
export {
  canAssignRole,
  canCreateApiKey,
  canDeleteInventory,
  canListAllApiKeys,
  canManageUser,
  canRevokeApiKey,
  canWriteInventory,
  roleAtLeast,
} from "./rbac.js";
export { ID_PREFIX, QUEUE_NAMES, REQUIRED_QUEUE_NAMES, SYSTEM_PING_JOB, WORKER_HEARTBEAT_KEY } from "./queues.js";
export type { QueueName } from "./queues.js";
export {
  DEFAULT_COOLDOWN_SECONDS,
  DEFAULT_HEALTH_CHECK_INTERVAL_SECONDS,
  DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
  DEFAULT_HEALTH_CHECK_URL,
  DEFAULT_HEALTH_THRESHOLDS,
  DEFAULT_MAX_COOLDOWN_SECONDS,
  DEGRADED_SCORE_MIN,
  HEALTH_CHECK_JOB,
  HEALTH_SCORE_MAX,
  HEALTH_SCORE_MIN,
  HEALTHY_SCORE_MIN,
  LATENCY_AVERAGE_WEIGHT,
  PROXY_RECOVERY_JOB,
  SCORE_DELTA,
  applyScore,
  clampHealthScore,
  cooldownWindowSeconds,
  healthCheckJobId,
  isRepeatedFailure,
  latencyAverage,
  nextCooldownSeconds,
  statusForScore,
} from "./health.js";
export type { HealthOutcome, HealthOutcomeKind, HealthThresholds, ProbeReason, ProxyProbeJob, ScoreInput, ScoreResult } from "./health.js";
export { ROTATION_CURSOR_PREFIX, eligibleProxies, isEligible, pickProxy, rotationCursorKey } from "./rotation.js";
export type { RotationCandidate } from "./rotation.js";
export {
  CLEANUP_JOB,
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_CAP_MS,
  MAX_REDIRECTS,
  MAX_REQUEST_BODY_CHARS,
  REQUEST_JOB,
  REQUEST_METHODS,
  REQUEST_URL_MAX_LENGTH,
  RETRY_JOB,
  USAGE_JOB,
  backoffDelayMs,
  inspectTargetUrl,
  parseAllowHosts,
  isBlockedAddress,
  isRequestMethod,
  isRetryableHttpStatus,
  rateWindowKey,
  requestJobId,
  retryJobId,
  usagePeriodStart,
} from "./request.js";
export type { RequestMethod, TargetVerdict } from "./request.js";
export {
  SITE_CHECK_BROWSERS,
  SITE_CHECK_JOB,
  SITE_CHECK_MAX_PROXIES,
  siteCheckLayout,
  siteCheckSummary,
} from "./site-check.js";
export type { SiteCheckBrowserName, SiteCheckLayout } from "./site-check.js";
export {
  PlanTier,
  PoolStatus,
  ProviderStatus,
  ProviderType,
  ProxyProtocol,
  ProxyStatus,
  RotationStrategy,
  UserRole,
  UserStatus,
} from "./enums.js";
export type {
  PlanTier as PlanTierName,
  PoolStatus as PoolStatusName,
  ProviderStatus as ProviderStatusName,
  ProviderType as ProviderTypeName,
  ProxyProtocol as ProxyProtocolName,
  ProxyStatus as ProxyStatusName,
  RotationStrategy as RotationStrategyName,
  UserRole as UserRoleName,
  UserStatus as UserStatusName,
} from "./enums.js";
