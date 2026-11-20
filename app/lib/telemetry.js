/**
 * Helpers for what we send to PostHog. Pure functions, unit-tested.
 *
 * Privacy rule: customer data (names, phones, emails, addresses) and secrets (tokens, HMACs,
 * cookies) never leave the server. Shopify's protected customer data terms require this, and it
 * keeps the PostHog project safe to share with anyone on the team.
 */

/** Keys whose values are always replaced by "[redacted]" (matched case-insensitively, anywhere in the key). */
const SECRET_KEYS = [
  "token", "secret", "password", "hmac", "signature", "authorization", "cookie", "session", "apikey", "api_key", "key",
  "phone", "email", "address", "firstname", "first_name", "lastname", "last_name", "customername", "customer_name",
  "customer", "fullname", "zip", "postal",
];
// Keys that contain a secret word but are fine to keep.
const SAFE_KEYS = new Set(["shop", "intent", "topic", "lang", "locale", "filter", "tab", "type", "kind", "status", "days", "id", "tpl", "templateid", "templatename", "embedded", "host", "keys"]);

export const REDACTED = "[redacted]";
const MAX_STRING = 300;
const MAX_KEYS = 40;
const MAX_DEPTH = 4;

export function isSecretKey(key) {
  const k = String(key).toLowerCase().replace(/[^a-z_]/g, "");
  if (SAFE_KEYS.has(k)) return false;
  return SECRET_KEYS.some((s) => k.includes(s));
}

/** Values that look like customer contact details even under an innocent key. */
function looksPersonal(value) {
  if (typeof value !== "string") return false;
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(value)) return true; // email
  if (/^\+?[\d\s().-]{9,}$/.test(value.trim())) return true; // phone number
  if (/^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return true; // JWT
  if (/^shp[a-z]{2}_[A-Za-z0-9]+$/.test(value)) return true; // Shopify access token
  return false;
}

/** Deep copy with secrets and personal data removed, long strings cut, big objects trimmed. */
export function sanitize(value, depth = 0) {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "string") {
    if (looksPersonal(value)) return REDACTED;
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(${value.length} chars)` : value;
  }
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) {
    const out = value.slice(0, 20).map((v) => sanitize(v, depth + 1));
    if (value.length > 20) out.push(`…(${value.length} items)`);
    return out;
  }
  if (typeof value === "object") {
    const out = {};
    const entries = Object.entries(value);
    for (const [k, v] of entries.slice(0, MAX_KEYS)) out[k] = isSecretKey(k) ? REDACTED : sanitize(v, depth + 1);
    if (entries.length > MAX_KEYS) out["…"] = `${entries.length - MAX_KEYS} more keys`;
    return out;
  }
  return String(value);
}

/** /c/AbC123token → /c/:token (confirm links are secrets). */
export function cleanPath(pathname) {
  return String(pathname || "/")
    .replace(/^\/c\/[^/]+/, "/c/:token")
    .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, "/:id");
}

export function queryParams(url) {
  return sanitize(Object.fromEntries(new URL(url).searchParams));
}

/** Read a JWT payload without verifying it (only to label logs with the shop). */
export function jwtPayload(token) {
  try {
    const part = String(token).split(".")[1];
    if (!part) return null;
    const json = typeof Buffer !== "undefined"
      ? Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
      : atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Which store a request belongs to, for grouping logs: webhook header, ?shop=, or the session token. */
export function shopFromRequest(request) {
  const h = request.headers;
  const fromHeader = h.get("x-shopify-shop-domain");
  if (fromHeader) return fromHeader;
  const url = new URL(request.url);
  const q = url.searchParams.get("shop");
  if (q) return q;
  const auth = h.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : url.searchParams.get("id_token");
  const dest = token ? jwtPayload(token)?.dest : null;
  if (dest) {
    try { return new URL(dest).host; } catch { /* ignore */ }
  }
  return null;
}

/** document | data | webhook | storefront | confirm_page | auth | asset */
export function requestKind(request) {
  const url = new URL(request.url);
  const p = url.pathname;
  if (p.startsWith("/webhooks")) return "webhook";
  if (p.startsWith("/proxy") || p.startsWith("/apps/")) return "storefront";
  if (p.startsWith("/c/")) return "confirm_page";
  if (p.startsWith("/auth")) return "auth";
  if (p.endsWith(".data") || url.searchParams.has("_data") || request.headers.get("x-react-router-data")) return "data";
  if (/\.(js|css|png|svg|ico|jpg|woff2?)$/.test(p)) return "asset";
  return "document";
}

/** Form or JSON body of a POST, cleaned. Reads a clone so the route can still read the original. */
export async function requestBody(request, maxBytes = 8000) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const type = request.headers.get("content-type") || "";
  try {
    const copy = request.clone();
    if (type.includes("application/json")) {
      const text = await copy.text();
      if (text.length > maxBytes) return { _note: `JSON body of ${text.length} bytes (too large to log)` };
      return sanitize(JSON.parse(text));
    }
    if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
      const form = await copy.formData();
      const obj = {};
      for (const [k, v] of form.entries()) obj[k] = typeof v === "string" ? tryJson(v) : `[file ${v.name}]`;
      return sanitize(obj);
    }
    if (type.includes("text/plain")) {
      const text = await copy.text();
      return text.length > maxBytes ? { _note: `${text.length} bytes` } : sanitize(tryJson(text));
    }
  } catch {
    return { _note: "body could not be read" };
  }
  return undefined;
}

function tryJson(s) {
  if (!/^\s*[[{]/.test(s)) return s;
  try { return JSON.parse(s); } catch { return s; }
}

/** Response body for JSON responses (resource routes, webhooks), cleaned. Others: just the size. */
export async function responseBody(response, maxBytes = 8000) {
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) return undefined;
  try {
    const text = await response.clone().text();
    if (text.length > maxBytes) return { _note: `JSON body of ${text.length} bytes` };
    return sanitize(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/** Error → PostHog "$exception" properties (error tracking). */
export function exceptionProperties(error, extra = {}) {
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : safeString(error));
  const frames = parseStack(err.stack);
  return {
    $exception_list: [
      {
        type: err.name || "Error",
        value: String(err.message || "").slice(0, 2000),
        mechanism: { handled: extra.handled ?? true, synthetic: !(error instanceof Error) },
        stacktrace: { type: "raw", frames },
      },
    ],
    $exception_type: err.name || "Error",
    $exception_message: String(err.message || "").slice(0, 2000),
    ...sanitize(extra),
  };
}

function safeString(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

/** V8 stack → frames, innermost last (the order PostHog expects). */
export function parseStack(stack) {
  if (!stack) return [];
  const frames = [];
  for (const line of String(stack).split("\n").slice(1, 40)) {
    const m = line.match(/^\s*at (?:(.*?) \()?(.*?):(\d+):(\d+)\)?$/);
    if (!m) continue;
    const filename = m[2].replace(/^file:\/\//, "");
    frames.push({
      platform: "node:javascript",
      function: m[1] || "<anonymous>",
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !filename.includes("node_modules") && !filename.startsWith("node:"),
    });
  }
  return frames.reverse();
}

/** Status → log level, used to filter in PostHog. */
export function levelFor(status) {
  if (status >= 500) return "error";
  if (status >= 400) return "warning";
  return "info";
}
