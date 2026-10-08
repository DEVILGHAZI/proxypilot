type JsonSchema = Record<string, unknown>;
type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
type PathMap = Record<string, Partial<Record<HttpMethod, Record<string, unknown>>>>;

const idParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", minLength: 1 },
} as const;

const jsonBody = (schema: JsonSchema) => ({
  required: true,
  content: { "application/json": { schema } },
});

const successResponses = (status = "200") => ({
  [status]: {
    description: "Successful response",
    content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } },
  },
  "400": { $ref: "#/components/responses/Error" },
  "401": { $ref: "#/components/responses/Error" },
  "403": { $ref: "#/components/responses/Error" },
  "404": { $ref: "#/components/responses/Error" },
  "409": { $ref: "#/components/responses/Error" },
  "429": { $ref: "#/components/responses/Error" },
  "503": { $ref: "#/components/responses/Error" },
});

const secured = (
  tag: string,
  summary: string,
  options: {
    status?: string;
    parameters?: readonly Record<string, unknown>[];
    body?: JsonSchema;
  } = {},
) => ({
  tags: [tag],
  summary,
  security: [{ bearerAuth: [] }, { sessionCookie: [] }],
  ...(options.parameters ? { parameters: options.parameters } : {}),
  ...(options.body ? { requestBody: jsonBody(options.body) } : {}),
  responses: successResponses(options.status),
});

const strings = (values: readonly string[]) => ({ type: "string", enum: values });
const identifierArray = { type: "array", maxItems: 500, items: { type: "string", minLength: 1 } };
const strategy = strings(["RANDOM", "ROUND_ROBIN", "LEAST_LATENCY", "WEIGHTED_HEALTH", "STICKY_SESSION"]);
const protocol = strings(["HTTP", "HTTPS", "SOCKS5"]);

const registerBody = {
  type: "object",
  required: ["email", "password", "name", "organizationName"],
  additionalProperties: false,
  properties: {
    email: { type: "string", format: "email", maxLength: 254 },
    password: { type: "string", minLength: 12, maxLength: 128, format: "password" },
    name: { type: "string", minLength: 1, maxLength: 80 },
    organizationName: { type: "string", minLength: 2, maxLength: 80 },
  },
};

const providerBody = {
  type: "object",
  required: ["name", "type", "protocol"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
    type: strings(["DATACENTER", "RESIDENTIAL", "ISP", "MOBILE", "CUSTOM"]),
    protocol,
    metadata: {
      type: "object",
      maxProperties: 20,
      additionalProperties: { oneOf: [{ type: "string", maxLength: 200 }, { type: "number" }, { type: "boolean" }] },
    },
    username: { type: ["string", "null"], maxLength: 256 },
    password: { type: ["string", "null"], maxLength: 256, format: "password" },
  },
};

const proxyProperties = {
  providerId: { type: "string", minLength: 1 },
  host: { type: "string", minLength: 1, maxLength: 253 },
  port: { type: "integer", minimum: 1, maximum: 65535 },
  protocol,
  username: { type: ["string", "null"], maxLength: 256 },
  password: { type: ["string", "null"], maxLength: 256, format: "password" },
  country: { type: ["string", "null"], maxLength: 80 },
  region: { type: ["string", "null"], maxLength: 80 },
  city: { type: ["string", "null"], maxLength: 80 },
  tagNames: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 40 } },
};

const policyProperties = {
  name: { type: "string", minLength: 1, maxLength: 80 },
  strategy,
  timeoutMs: { type: "integer", minimum: 100, maximum: 300000 },
  maxRetries: { type: "integer", minimum: 0, maximum: 10 },
  cooldownSeconds: { type: "integer", minimum: 0, maximum: 86400 },
  sessionTtlSeconds: { type: "integer", minimum: 30, maximum: 604800 },
  maxConcurrency: { type: "integer", minimum: 1, maximum: 1000 },
  requestsPerSecond: { type: "integer", minimum: 1, maximum: 10000 },
  enabled: { type: "boolean" },
};

const paths: PathMap = {
  "/health": {
    get: { tags: ["System"], summary: "Check API liveness", security: [], responses: successResponses() },
  },
  "/ready": {
    get: { tags: ["System"], summary: "Check API dependencies", security: [], responses: successResponses() },
  },
  "/api/v1": {
    get: { tags: ["System"], summary: "Read API version", security: [], responses: successResponses() },
  },
  "/openapi.json": {
    get: {
      tags: ["System"],
      summary: "Read the OpenAPI document",
      security: [],
      responses: { "200": { description: "OpenAPI 3.1 document" } },
    },
  },
  "/api/v1/auth/register": {
    post: {
      tags: ["Auth"],
      summary: "Create an organization and owner",
      security: [],
      requestBody: jsonBody(registerBody),
      responses: successResponses("201"),
    },
  },
  "/api/v1/auth/login": {
    post: {
      tags: ["Auth"],
      summary: "Create a browser session",
      security: [],
      requestBody: jsonBody({
        type: "object",
        required: ["email", "password"],
        additionalProperties: false,
        properties: {
          email: { type: "string", format: "email", maxLength: 254 },
          password: { type: "string", minLength: 1, maxLength: 128, format: "password" },
        },
      }),
      responses: successResponses(),
    },
  },
  "/api/v1/auth/logout": { post: secured("Auth", "Revoke the browser session") },
  "/api/v1/auth/me": { get: secured("Auth", "Read the current identity") },
  "/api/v1/users": {
    get: secured("Users", "List organization users"),
    post: secured("Users", "Create an organization user", {
      status: "201",
      body: {
        type: "object",
        required: ["email", "password", "name", "role"],
        additionalProperties: false,
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 12, maxLength: 128, format: "password" },
          name: { type: "string", minLength: 1, maxLength: 80 },
          role: strings(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
        },
      },
    }),
  },
  "/api/v1/users/{id}": {
    patch: secured("Users", "Change a user's role or status", {
      parameters: [idParameter],
      body: {
        type: "object",
        minProperties: 1,
        additionalProperties: false,
        properties: {
          role: strings(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
          status: strings(["ACTIVE", "SUSPENDED", "DISABLED"]),
        },
      },
    }),
  },
  "/api/v1/api-keys": {
    get: secured("API keys", "List API keys"),
    post: secured("API keys", "Create an API key", {
      status: "201",
      body: {
        type: "object",
        required: ["name"],
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1, maxLength: 64 },
          expiresAt: { type: "string", format: "date-time" },
        },
      },
    }),
  },
  "/api/v1/api-keys/{id}/revoke": {
    post: secured("API keys", "Revoke an API key", { parameters: [idParameter] }),
  },
  "/api/v1/providers": {
    get: secured("Inventory", "List providers"),
    post: secured("Inventory", "Create a provider", { status: "201", body: providerBody }),
  },
  "/api/v1/providers/{id}": {
    patch: secured("Inventory", "Update a provider", {
      parameters: [idParameter],
      body: { ...providerBody, required: undefined, minProperties: 1 },
    }),
    delete: secured("Inventory", "Delete a provider", { parameters: [idParameter] }),
  },
  "/api/v1/proxies": {
    get: secured("Inventory", "List proxies", {
      parameters: [
        { name: "providerId", in: "query", schema: { type: "string" } },
        { name: "status", in: "query", schema: strings(["HEALTHY", "DEGRADED", "QUARANTINED", "DISABLED"]) },
        { name: "tag", in: "query", schema: { type: "string", maxLength: 40 } },
        { name: "poolId", in: "query", schema: { type: "string" } },
      ],
    }),
    post: secured("Inventory", "Create a proxy", {
      status: "201",
      body: {
        type: "object",
        required: ["providerId", "host", "port"],
        additionalProperties: false,
        properties: proxyProperties,
      },
    }),
  },
  "/api/v1/proxies/{id}": {
    patch: secured("Inventory", "Update a proxy", {
      parameters: [idParameter],
      body: {
        type: "object",
        minProperties: 1,
        additionalProperties: false,
        properties: Object.fromEntries(Object.entries(proxyProperties).filter(([key]) => key !== "providerId")),
      },
    }),
    delete: secured("Inventory", "Delete a proxy", { parameters: [idParameter] }),
  },
  "/api/v1/proxies/{id}/disable": {
    post: secured("Inventory", "Disable a proxy", { parameters: [idParameter] }),
  },
  "/api/v1/proxies/{id}/enable": {
    post: secured("Inventory", "Enable a proxy", { parameters: [idParameter] }),
  },
  "/api/v1/proxies/{id}/check": {
    post: secured("Health", "Queue a proxy health check", { status: "202", parameters: [idParameter] }),
  },
  "/api/v1/proxies/import": {
    post: secured("Inventory", "Import proxies", {
      status: "201",
      body: {
        type: "object",
        required: ["providerId", "text"],
        additionalProperties: false,
        properties: {
          providerId: { type: "string", minLength: 1 },
          text: { type: "string", minLength: 1, maxLength: 200000 },
          protocol,
        },
      },
    }),
  },
  "/api/v1/tags": { get: secured("Inventory", "List tags") },
  "/api/v1/tags/{id}": {
    delete: secured("Inventory", "Delete a tag", { parameters: [idParameter] }),
  },
  "/api/v1/pools": {
    get: secured("Pools", "List pools"),
    post: secured("Pools", "Create a pool", {
      status: "201",
      body: {
        type: "object",
        required: ["name"],
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1, maxLength: 80 },
          description: { type: ["string", "null"], maxLength: 240 },
          strategy: { ...strategy, default: "ROUND_ROBIN" },
          policyId: { type: ["string", "null"] },
        },
      },
    }),
  },
  "/api/v1/pools/{id}/proxies": {
    put: secured("Pools", "Replace pool membership", {
      parameters: [idParameter],
      body: {
        type: "object",
        required: ["proxyIds"],
        additionalProperties: false,
        properties: { proxyIds: identifierArray },
      },
    }),
  },
  "/api/v1/pools/{id}/select": {
    post: secured("Rotation", "Select an eligible proxy", { parameters: [idParameter] }),
  },
  "/api/v1/pools/{id}/requests": {
    post: secured("Requests", "Queue a request through a pool", {
      status: "202",
      parameters: [idParameter],
      body: {
        type: "object",
        required: ["url"],
        additionalProperties: false,
        properties: {
          url: { type: "string", format: "uri", maxLength: 2048 },
          method: { ...strings(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]), default: "GET" },
          body: { type: ["string", "null"], maxLength: 16384 },
        },
      },
    }),
  },
  "/api/v1/policies": {
    get: secured("Policies", "List policies"),
    post: secured("Policies", "Create a policy", {
      status: "201",
      body: {
        type: "object",
        required: [
          "name",
          "strategy",
          "timeoutMs",
          "maxRetries",
          "cooldownSeconds",
          "sessionTtlSeconds",
          "maxConcurrency",
          "requestsPerSecond",
        ],
        additionalProperties: false,
        properties: policyProperties,
      },
    }),
  },
  "/api/v1/policies/{id}": {
    patch: secured("Policies", "Update a policy", {
      parameters: [idParameter],
      body: { type: "object", minProperties: 1, additionalProperties: false, properties: policyProperties },
    }),
    delete: secured("Policies", "Delete a policy", { parameters: [idParameter] }),
  },
  "/api/v1/sessions": { get: secured("Rotation", "List sticky proxy sessions") },
  "/api/v1/sessions/{id}": {
    delete: secured("Rotation", "Release a sticky proxy session", { parameters: [idParameter] }),
  },
  "/api/v1/health": {
    get: secured("Health", "List proxy health checks", {
      parameters: [
        { name: "proxyId", in: "query", schema: { type: "string" } },
        { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
      ],
    }),
  },
  "/api/v1/requests": {
    get: secured("Requests", "List request jobs", {
      parameters: [
        { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
      ],
    }),
  },
  "/api/v1/requests/{id}": {
    get: secured("Requests", "Read a request job and its attempts", { parameters: [idParameter] }),
  },
  "/api/v1/pools/{id}/site-checks": {
    post: secured("Requests", "Open a site in Chrome through every pool proxy", {
      status: "202",
      parameters: [idParameter],
      body: {
        type: "object",
        required: ["url"],
        additionalProperties: false,
        properties: {
          url: { type: "string", format: "uri", maxLength: 2048 },
          browser: { ...strings(["CHROME", "PHONE", "MIXED"]), default: "CHROME" },
        },
      },
    }),
  },
  "/api/v1/site-checks": {
    get: secured("Requests", "List site checks", {
      parameters: [
        { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 20, default: 10 } },
      ],
    }),
  },
  "/api/v1/site-checks/{id}": {
    get: secured("Requests", "Read a site check", { parameters: [idParameter] }),
  },
  "/api/v1/analytics": {
    get: secured("Analytics", "Read dashboard analytics", {
      parameters: [
        { name: "hours", in: "query", schema: { type: "integer", minimum: 1, maximum: 168, default: 24 } },
      ],
    }),
  },
  "/api/v1/audit": {
    get: secured("Audit", "List organization audit events", {
      parameters: [
        { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
      ],
    }),
  },
};

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "ProxyPilot API",
    version: "0.1.0",
    description:
      "Control and observe authorized proxy-backed HTTP workloads. Proxy rotation does not grant permission to access a target.",
  },
  servers: [{ url: "http://localhost:4000", description: "Local API" }],
  tags: [
    "System",
    "Auth",
    "Users",
    "API keys",
    "Inventory",
    "Pools",
    "Policies",
    "Rotation",
    "Health",
    "Requests",
    "Analytics",
    "Audit",
  ].map((name) => ({ name })),
  paths,
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "pp_live API key" },
      sessionCookie: { type: "apiKey", in: "cookie", name: "pp_session" },
    },
    schemas: {
      Success: {
        type: "object",
        required: ["success", "requestId", "data"],
        properties: {
          success: { const: true },
          requestId: { type: "string", pattern: "^req_" },
          data: { type: "object", additionalProperties: true },
        },
      },
      Error: {
        type: "object",
        required: ["success", "requestId", "error"],
        properties: {
          success: { const: false },
          requestId: { type: "string", pattern: "^req_" },
          error: {
            type: "object",
            required: ["code", "message"],
            properties: { code: { type: "string" }, message: { type: "string" } },
          },
        },
      },
    },
    responses: {
      Error: {
        description: "Error response",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  },
} as const;
