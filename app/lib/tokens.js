import crypto from "node:crypto";

/**
 * Unguessable token for the public confirm page: /c/<token>
 * 22 base64url characters = 128 bits of randomness (the link stays short: no external shortener).
 * Links sent before Nov 2026 used 12 characters (72 bits) and keep working until they expire.
 */
export function generateToken() {
  return crypto.randomBytes(16).toString("base64url");
}

export function isValidTokenFormat(token) {
  return typeof token === "string" && /^(?:[A-Za-z0-9_-]{22}|[A-Za-z0-9_-]{12})$/.test(token);
}

/** Confirm links stop working after this many days. */
export const TOKEN_TTL_DAYS = 14;

export function tokenExpiry(from = new Date()) {
  return new Date(from.getTime() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
