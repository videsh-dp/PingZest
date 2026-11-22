import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loopTimers, isReminderDue, isExpiryDue, nextStep, canCancelInShopify, shouldAutoCancel, holdableFulfillmentOrders,
  shouldProcess, parseActionError, reminderWhere, expiryWhere,
} from "../app/lib/cod-loop.js";

const H = 3600000;
const now = new Date("2026-11-22T12:00:00Z");
const sentAgo = (hours, extra = {}) => ({ isCod: true, codStatus: "sent", codSentAt: new Date(now - hours * H), ...extra });
const settings = { codRemindHours: 24, codExpireHours: 72 };

test("timers: defaults, clamping, expiry always after the reminder", () => {
  assert.deepEqual(
    { r: loopTimers({}).remindHours, e: loopTimers({}).expireHours },
    { r: 24, e: 72 },
  );
  assert.equal(loopTimers({ codRemindHours: 0 }).remindHours, 1);
  assert.equal(loopTimers({ codRemindHours: 999 }).remindHours, 168);
  assert.equal(loopTimers({ codRemindHours: "abc" }).remindHours, 24);
  assert.equal(loopTimers({ codRemindHours: 48, codExpireHours: 24 }).expireHours, 49, "expire moves after remind");
  assert.equal(loopTimers({ codExpireHours: 10000 }).expireHours, 720);
});

test("reminder due after 24h without a reply, once", () => {
  assert.equal(isReminderDue(sentAgo(23), settings, now), false);
  assert.equal(isReminderDue(sentAgo(25), settings, now), true);
  assert.equal(isReminderDue(sentAgo(25, { codRemindedAt: now }), settings, now), false, "already reminded");
  assert.equal(isReminderDue(sentAgo(25, { codStatus: "confirmed" }), settings, now), false);
  assert.equal(isReminderDue(sentAgo(25, { shippedAt: now }), settings, now), false, "shipped");
  assert.equal(isReminderDue({ isCod: true, codStatus: "pending", codSentAt: null }, settings, now), false, "never sent: merchant's backlog");
});

test("expiry due after 72h, even when reminded; never for prepaid or shipped", () => {
  assert.equal(isExpiryDue(sentAgo(71), settings, now), false);
  assert.equal(isExpiryDue(sentAgo(73, { codRemindedAt: now }), settings, now), true);
  assert.equal(isExpiryDue(sentAgo(73, { convertedToPrepaid: true }), settings, now), false);
  assert.equal(isExpiryDue(sentAgo(73, { shippedAt: now }), settings, now), false);
  assert.equal(isExpiryDue(sentAgo(100, { codStatus: "no_reply" }), settings, now), false, "already expired");
});

test("next step: reminder first, then expiry", () => {
  const o = sentAgo(1);
  assert.deepEqual(nextStep(o, settings), { kind: "remind", at: new Date(o.codSentAt.getTime() + 24 * H) });
  assert.deepEqual(nextStep({ ...o, codRemindedAt: now }, settings), { kind: "expire", at: new Date(o.codSentAt.getTime() + 72 * H) });
  assert.equal(nextStep({ ...o, codStatus: "confirmed" }, settings), null);
});

test("cancel in Shopify only for unshipped, unpaid, cancelled or unanswered COD orders, once", () => {
  const base = { isCod: true, codStatus: "cancelled" };
  assert.equal(canCancelInShopify(base), true);
  assert.equal(canCancelInShopify({ ...base, codStatus: "no_reply" }), true);
  assert.equal(canCancelInShopify({ ...base, codStatus: "confirmed" }), false);
  assert.equal(canCancelInShopify({ ...base, shippedAt: now }), false);
  assert.equal(canCancelInShopify({ ...base, convertedToPrepaid: true }), false);
  assert.equal(canCancelInShopify({ ...base, paidAt: now }), false);
  assert.equal(canCancelInShopify({ ...base, shopifyCancelledAt: now }), false);
  assert.equal(canCancelInShopify({ ...base, isCod: false }), false);
});

test("auto-cancel needs Pro and the matching opt-in", () => {
  const order = { isCod: true, codStatus: "sent" };
  const on = { cancelOnCustomer: true, cancelOnExpire: true };
  assert.equal(shouldAutoCancel(order, { status: "cancelled", by: "customer" }, on, true), true);
  assert.equal(shouldAutoCancel(order, { status: "cancelled", by: "customer" }, on, false), false, "Free");
  assert.equal(shouldAutoCancel(order, { status: "cancelled", by: "merchant" }, on, true), false, "merchant cancels by hand");
  assert.equal(shouldAutoCancel(order, { status: "cancelled", by: "customer" }, { cancelOnCustomer: false }, true), false);
  assert.equal(shouldAutoCancel(order, { status: "no_reply", expired: true }, on, true), true);
  assert.equal(shouldAutoCancel(order, { status: "no_reply", expired: true }, { cancelOnExpire: false }, true), false);
  assert.equal(shouldAutoCancel({ ...order, shippedAt: now }, { status: "cancelled", by: "customer" }, on, true), false);
  assert.equal(shouldAutoCancel(order, { status: "confirmed", by: "customer" }, on, true), false);
});

test("only open fulfillment orders are held; throttle; action errors", () => {
  assert.deepEqual(holdableFulfillmentOrders([{ id: "a", status: "OPEN" }, { id: "b", status: "CLOSED" }, { id: "c", status: "ON_HOLD" }, null]).map((f) => f.id), ["a"]);
  assert.equal(shouldProcess(null, now), true);
  assert.equal(shouldProcess(new Date(now - 5 * 60000), now), false);
  assert.equal(shouldProcess(new Date(now - 11 * 60000), now), true);
  assert.deepEqual(parseActionError("hold: Fulfillment order is closed"), { kind: "hold", message: "Fulfillment order is closed" });
  assert.deepEqual(parseActionError("weird"), { kind: "other", message: "weird" });
});

test("database filters use the same timers", () => {
  const r = reminderWhere(settings, now);
  assert.equal(r.codStatus, "sent");
  assert.equal(r.codSentAt.lte.getTime(), now - 24 * H);
  assert.equal(r.AND.length, 2, "not shipped, not reminded");
  const e = expiryWhere(settings, now);
  assert.equal(e.codSentAt.lte.getTime(), now - 72 * H);
  assert.equal(e.convertedToPrepaid, false);
});
