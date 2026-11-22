/**
 * Closing the COD loop: when an unconfirmed COD order needs a reminder, when it expires, and whether
 * PingZest may cancel it in Shopify. Pure functions (unit-tested); the database and Shopify side is in
 * app/models/cod-loop.server.js.
 *
 * Timers count from when the confirmation message was opened in WhatsApp (codSentAt): an order the
 * merchant never sent is the merchant's backlog, not the customer's silence, so it never expires.
 */

import { N_ } from "../i18n/core.js";

const HOUR = 3600000;

/** What a failed Shopify action was, for alerts (translated in the UI). */
export const ACTION_LABELS = {
  hold: N_("Couldn't hold fulfillment"), release: N_("Couldn't release the hold"), cancel: N_("Couldn't cancel in Shopify"),
  tag: N_("Couldn't tag the order"), other: N_("Shopify action failed"),
};

export const LOOP_DEFAULTS = { remindHours: 24, expireHours: 72 };

/** Hours from settings, clamped: remind 1–168 h, expire after the reminder and at most 30 days. */
export function loopTimers(settings = {}) {
  const remind = clampInt(settings.codRemindHours, 1, 168, LOOP_DEFAULTS.remindHours);
  const expire = Math.max(clampInt(settings.codExpireHours, 2, 720, LOOP_DEFAULTS.expireHours), remind + 1);
  return { remindHours: remind, expireHours: expire, remindMs: remind * HOUR, expireMs: expire * HOUR };
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

const open = (o) => o && o.isCod !== false && o.codStatus === "sent" && o.codSentAt && !o.shippedAt && !o.convertedToPrepaid;
const age = (o, now) => now.getTime() - new Date(o.codSentAt).getTime();

/** Waiting for a reply for longer than the reminder time, and no reminder sent yet. */
export function isReminderDue(order, settings, now = new Date()) {
  return Boolean(open(order) && !order.codRemindedAt && age(order, now) >= loopTimers(settings).remindMs);
}

/** Waiting for a reply for longer than the expiry time. */
export function isExpiryDue(order, settings, now = new Date()) {
  return Boolean(open(order) && age(order, now) >= loopTimers(settings).expireMs);
}

/** When the next step happens for a waiting order: { kind: "remind" | "expire", at: Date } or null. */
export function nextStep(order, settings) {
  if (!open(order)) return null;
  const { remindMs, expireMs } = loopTimers(settings);
  const sent = new Date(order.codSentAt).getTime();
  if (!order.codRemindedAt) return { kind: "remind", at: new Date(sent + remindMs) };
  return { kind: "expire", at: new Date(sent + expireMs) };
}

/** Prisma filters for the same rules (kept here so the queue, the badge and the job agree). */
export function reminderWhere(settings, now = new Date()) {
  const { remindMs } = loopTimers(settings);
  return { isCod: true, codStatus: "sent", codSentAt: { lte: new Date(now.getTime() - remindMs) }, convertedToPrepaid: false, AND: [unset("shippedAt"), unset("codRemindedAt")] };
}
export function expiryWhere(settings, now = new Date()) {
  const { expireMs } = loopTimers(settings);
  return { isCod: true, codStatus: "sent", codSentAt: { lte: new Date(now.getTime() - expireMs) }, convertedToPrepaid: false, AND: [unset("shippedAt")] };
}
function unset(field) {
  return { OR: [{ [field]: null }, { [field]: { isSet: false } }] };
}

/**
 * May PingZest cancel this order in Shopify? Only COD orders the customer cancelled or that got no
 * reply, not shipped, not paid online, and not cancelled by PingZest already.
 */
export function canCancelInShopify(order) {
  return Boolean(
    order && order.isCod && ["cancelled", "no_reply"].includes(order.codStatus) &&
    !order.shippedAt && !order.convertedToPrepaid && !order.paidAt && !order.shopifyCancelledAt,
  );
}

/** Should PingZest cancel automatically (Pro, merchant opted in) after this change? */
export function shouldAutoCancel(order, { status, by, expired = false }, settings, pro) {
  if (!pro || !canCancelInShopify({ ...order, codStatus: status })) return false;
  if (expired) return Boolean(settings.cancelOnExpire);
  return status === "cancelled" && by === "customer" && Boolean(settings.cancelOnCustomer);
}

/** Fulfillment orders PingZest can put on hold: open ones only. */
export function holdableFulfillmentOrders(nodes = []) {
  return (nodes || []).filter((fo) => fo && fo.id && fo.status === "OPEN");
}

/** Throttle for running due work on app load: at most every `minutes`. */
export function shouldProcess(lastRun, now = new Date(), minutes = 10) {
  return !lastRun || now.getTime() - new Date(lastRun).getTime() >= minutes * 60000;
}

/** "hold: Fulfillment order is closed" → { kind: "hold", message } */
export function parseActionError(text) {
  const m = /^(\w+):\s*(.*)$/s.exec(String(text || ""));
  return m ? { kind: m[1], message: m[2] } : { kind: "other", message: String(text || "") };
}
