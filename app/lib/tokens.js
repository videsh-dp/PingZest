import crypto from "node:crypto";

/**
 * Short, unguessable token for the public confirm page: /c/<token>
 * 12 base64url characters = 72 bits of randomness.
 */
export function generateToken() {
  return crypto.randomBytes(9).toString("base64url");
}

export function isValidTokenFormat(token) {
  return typeof token === "string" && /^[A-Za-z0-9_-]{12}$/.test(token);
}

/** Confirm links stop working after this many days. */
export const TOKEN_TTL_DAYS = 14;

export function tokenExpiry(from = new Date()) {
  return new Date(from.getTime() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
