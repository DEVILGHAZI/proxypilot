import { ID_PREFIX } from "./queues.js";

export const API_KEY_PREFIX = `${ID_PREFIX.apiKey}_`;
export const SESSION_COOKIE = "pp_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
export const LOGIN_FAILURE_LIMIT = 10;
export const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;
