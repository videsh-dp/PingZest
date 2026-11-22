/**
 * Closing the COD loop in Shopify (docs/TICKETS.md PZ-01..03):
 * - hold fulfillment of a new COD order until it's confirmed (Free, opt-in), released on confirm
 * - tags for confirmed / cancelled / no reply
 * - expire orders with no reply (Free: a button; Pro: automatically)
 * - cancel + restock in Shopify (Free: a button; Pro: automatically, opt-in)
 *
 * No worker process: due work runs on COD webhooks and app loads (throttled), and on POST /cron/cod.
 * A failed Shopify call never breaks the flow: it's stored on the order (actionError) and shown as an alert.
 */
import prisma from "../db.server";
import { getSettings } from "./settings.server";
import {
  tagOrder, removeOrderTags, fetchFulfillmentOrders, holdFulfillmentOrder, releaseFulfillmentHold, cancelShopifyOrder,
} from "./shopify-admin.server";
import { hasFeature, planOf } from "../lib/plans.js";
import { canCancelInShopify, expiryWhere, holdableFulfillmentOrders, shouldAutoCancel, shouldProcess } from "../lib/cod-loop.js";
import { capture } from "../posthog.server";

const errorText = (e) => String(e?.message || e || "error").slice(0, 300);

async function recordError(order, kind, e) {
  console.error(`COD ${kind} failed`, errorText(e));
  capture("cod_action_failed", order.shop, { kind, error: errorText(e) });
  await prisma.order.update({ where: { id: order.id }, data: { actionError: `${kind}: ${errorText(e)}`, actionErrorAt: new Date() } }).catch(() => {});
}

async function clearError(order) {
  if (order.actionError) await prisma.order.update({ where: { id: order.id }, data: { actionError: null, actionErrorAt: null } }).catch(() => {});
}

export const isPro = (settings) => hasFeature(planOf(settings), "codAutomation");

/** Hold every open fulfillment order of a new COD order (when the merchant turned it on). */
export async function holdCodOrder(order, admin, settings) {
  if (!settings?.codHold || !order?.isCod || order.heldAt || !admin) return null;
  if (!["pending", "sent"].includes(order.codStatus)) return null;
  try {
    const { nodes } = await fetchFulfillmentOrders(admin, order.orderGid);
    const holdable = holdableFulfillmentOrders(nodes);
    if (!holdable.length) return null;
    const holds = [];
    for (const fo of holdable) {
      holds.push({ fo: fo.id, hold: await holdFulfillmentOrder(admin, fo.id, "PingZest: waiting for the customer to confirm this Cash on Delivery order") });
    }
    capture("cod_fulfillment_held", order.shop, { count: holds.length });
    return prisma.order.update({ where: { id: order.id }, data: { heldAt: new Date(), fulfillmentHolds: holds, actionError: null, actionErrorAt: null } });
  } catch (e) {
    await recordError(order, "hold", e);
    return null;
  }
}

/** Release PingZest's holds so the order can be fulfilled. */
export async function releaseCodHold(order, admin) {
  if (!order?.heldAt || order.holdReleasedAt || !admin) return null;
  try {
    for (const h of Array.isArray(order.fulfillmentHolds) ? order.fulfillmentHolds : []) {
      await releaseFulfillmentHold(admin, h.fo, h.hold);
    }
    capture("cod_fulfillment_released", order.shop, {});
    await clearError(order);
    return prisma.order.update({ where: { id: order.id }, data: { holdReleasedAt: new Date() } });
  } catch (e) {
    await recordError(order, "release", e);
    return null;
  }
}

/** Cancel in Shopify (restock per settings). Returns { ok } or { error }. */
export async function cancelInShopify(order, admin, settings, { auto = false } = {}) {
  if (!canCancelInShopify(order)) return { error: "This order can't be cancelled by PingZest." };
  try {
    await cancelShopifyOrder(admin, order.orderGid, {
      restock: settings.cancelRestock !== false,
      reason: order.codStatus === "cancelled" ? "CUSTOMER" : "OTHER",
      note: order.codStatus === "cancelled"
        ? "PingZest: the customer cancelled this Cash on Delivery order"
        : "PingZest: no reply to the Cash on Delivery confirmation",
    });
    await prisma.order.update({ where: { id: order.id }, data: { shopifyCancelledAt: new Date(), actionError: null, actionErrorAt: null } });
    capture("cod_cancelled_in_shopify", order.shop, { auto, status: order.codStatus, restock: settings.cancelRestock !== false });
    return { ok: true };
  } catch (e) {
    await recordError(order, "cancel", e);
    return { error: errorText(e) };
  }
}

/** Tags for the new status: add its tag, remove the others. */
async function syncTags(order, status, admin, settings) {
  const byStatus = { confirmed: settings.confirmedTag, cancelled: settings.cancelledTag, no_reply: settings.noReplyTag };
  const add = byStatus[status];
  if (!add || !admin) return;
  const remove = Object.values(byStatus).filter((t) => t && t !== add);
  try {
    const ok = await tagOrder(admin, order.orderGid, [add]);
    if (!ok) throw new Error(`Couldn't add the tag “${add}”`);
    if (remove.length) await removeOrderTags(admin, order.orderGid, remove);
  } catch (e) {
    await recordError(order, "tag", e);
  }
}

/**
 * Everything that follows a COD status change, wherever it came from (customer on the confirm page,
 * merchant in the app, payment, expiry): tags, releasing the hold on confirm, and the opt-in cancel.
 */
export async function applyCodOutcome(order, { status, by = "merchant", expired = false }, admin, settings) {
  if (!order) return;
  settings = settings || (await getSettings(order.shop));
  await syncTags(order, status, admin, settings);
  if (status === "confirmed") await releaseCodHold(order, admin);
  if (shouldAutoCancel(order, { status, by, expired }, settings, isPro(settings))) {
    await cancelInShopify({ ...order, codStatus: status }, admin, settings, { auto: true });
  }
}

/** Waiting order → No reply (expired). `by` is "merchant" (button) or "auto" (Pro). */
export async function expireOrder(order, admin, settings, by = "merchant") {
  const r = await prisma.order.updateMany({ where: { id: order.id, shop: order.shop, codStatus: { in: ["pending", "sent"] } }, data: { codStatus: "no_reply", codExpiredAt: new Date() } });
  if (!r.count) return false;
  const fresh = await prisma.order.findUnique({ where: { id: order.id } });
  await applyCodOutcome(fresh, { status: "no_reply", by, expired: true }, admin, settings);
  capture("cod_expired", order.shop, { by });
  return true;
}

/**
 * Due work for one shop: Pro automatic expiry (and the opt-in cancel that follows). Safe to call often:
 * with `throttle` it runs at most every 10 minutes per shop (claimed atomically, so two requests don't both run).
 */
export async function processDueCod(shop, admin, { throttle = true, now = new Date(), limit = 50 } = {}) {
  const settings = await getSettings(shop);
  if (!isPro(settings) || !settings.codAutoExpire || !admin) return { expired: 0, skipped: true };
  if (throttle) {
    if (!shouldProcess(settings.codProcessedAt, now)) return { expired: 0, skipped: true };
    const cutoff = new Date(now.getTime() - 10 * 60000);
    const claim = await prisma.shopSettings.updateMany({
      where: { shop, OR: [{ codProcessedAt: null }, { codProcessedAt: { isSet: false } }, { codProcessedAt: { lt: cutoff } }] },
      data: { codProcessedAt: now },
    });
    if (!claim.count) return { expired: 0, skipped: true };
  } else {
    await prisma.shopSettings.update({ where: { shop }, data: { codProcessedAt: now } });
  }
  const due = await prisma.order.findMany({ where: { shop, ...expiryWhere(settings, now) }, orderBy: { codSentAt: "asc" }, take: limit });
  let expired = 0;
  for (const o of due) if (await expireOrder(o, admin, settings, "auto")) expired += 1;
  return { expired };
}

/** Clear a failed-action alert after the merchant has dealt with it. */
export async function dismissActionError(shop, id) {
  return prisma.order.updateMany({ where: { id, shop }, data: { actionError: null, actionErrorAt: null } });
}

/** Retry the failed action of an order. */
export async function retryAction(order, admin, settings) {
  const kind = String(order.actionError || "").split(":")[0];
  if (kind === "hold") return holdCodOrder({ ...order, heldAt: null }, admin, settings);
  if (kind === "release") return releaseCodHold(order, admin);
  if (kind === "cancel") return cancelInShopify(order, admin, settings);
  if (kind === "tag") return syncTags(order, order.codStatus, admin, settings).then(() => clearErrorIfNoNew(order));
  return dismissActionError(order.shop, order.id);
}

async function clearErrorIfNoNew(order) {
  const fresh = await prisma.order.findUnique({ where: { id: order.id } });
  if (fresh?.actionErrorAt && order.actionErrorAt && fresh.actionErrorAt > order.actionErrorAt) return;
  await clearError(fresh);
}
