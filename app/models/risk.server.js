/**
 * COD risk score: computed for every COD order when it arrives (all plans, so a store that
 * upgrades sees scores straight away); shown and tagged only on Pro.
 */
import prisma from "../db.server";
import { scoreOrder, addressSignals, maxQuantity, median } from "../lib/risk.js";
import { hasFeature, planOf } from "../lib/plans.js";
import { getSettings } from "./settings.server";
import { tagOrder } from "./shopify-admin.server";
import { capture } from "../posthog.server";

const DAY = 86400000;

/** Earlier COD orders in this store for the same phone / PIN code, and the store's usual order value. */
export async function riskHistory(shop, { id, phone, pincode }) {
  const others = { shop, isCod: true, ...(id ? { NOT: { id } } : {}) };
  const twoDaysAgo = new Date(Date.now() - 2 * DAY);
  const [byPhone, recent, pinOrders, pinCancelled, lastTotals] = await Promise.all([
    phone ? prisma.order.findMany({ where: { ...others, phone }, select: { codStatus: true, codSentAt: true } }) : [],
    phone ? prisma.order.count({ where: { ...others, phone, createdAt: { gte: new Date(Date.now() - DAY) } } }) : 0,
    pincode ? prisma.order.count({ where: { ...others, pincode } }) : 0,
    pincode ? prisma.order.count({ where: { ...others, pincode, codStatus: "cancelled" } }) : 0,
    prisma.order.findMany({ where: others, select: { totalPrice: true }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  return {
    phoneCancelled: byPhone.filter((o) => o.codStatus === "cancelled").length,
    phoneConfirmed: byPhone.filter((o) => o.codStatus === "confirmed").length,
    phoneNoReply: byPhone.filter((o) => o.codStatus === "no_reply" || (o.codStatus === "sent" && o.codSentAt && o.codSentAt < twoDaysAgo)).length,
    phoneOrders24h: recent,
    pinOrders,
    pinCancelled,
    medianTotal: median(lastTotals.map((o) => Number(o.totalPrice))),
    shopOrders: lastTotals.length,
  };
}

/** Score a COD order from its webhook payload, store the result, and tag it in Shopify on Pro. */
export async function assessOrder(shop, order, payload, admin) {
  if (!order?.isCod) return null;
  const { pincode, flags } = addressSignals(payload.shipping_address || payload.billing_address);
  const facts = { totalPrice: order.totalPrice, phone: order.phone, pincode, addressFlags: flags, maxQuantity: maxQuantity(payload.line_items) };
  const history = await riskHistory(shop, { id: order.id, phone: order.phone, pincode });
  const risk = scoreOrder(facts, history);
  await prisma.order.update({
    where: { id: order.id },
    data: { pincode, addressFlags: flags, riskScore: risk.score, riskLevel: risk.level, riskReasons: risk.reasons },
  });
  const settings = await getSettings(shop);
  const pro = hasFeature(planOf(settings), "codRisk");
  if (pro && risk.level === "high" && settings.riskTagHigh && admin) {
    await tagOrder(admin, order.orderGid, [settings.riskTag]).catch((e) => console.error("risk tag failed", e?.message));
  }
  capture("cod_risk_scored", shop, { level: risk.level, score: risk.score, reasons: risk.reasons.map((r) => r.code), plan: planOf(settings) });
  return risk;
}

/** For the Free plan teaser: how many COD orders looked risky lately (no details). */
export async function riskTeaser(shop, days = 30) {
  const since = new Date(Date.now() - days * DAY);
  const [high, medium] = await Promise.all([
    prisma.order.count({ where: { shop, isCod: true, riskLevel: "high", createdAt: { gte: since } } }),
    prisma.order.count({ where: { shop, isCod: true, riskLevel: "medium", createdAt: { gte: since } } }),
  ]);
  return { high, medium };
}
