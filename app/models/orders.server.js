/**
 * Database access for orders, checkouts and widget stats.
 */
import prisma from "../db.server";
import { orderRecordFromWebhook, checkoutRecordFromWebhook, trackingFromFulfillment } from "../lib/orders.js";
import { generateToken, tokenExpiry } from "../lib/tokens.js";
import { N_ } from "../i18n/core.js";
import { COD_FILTERS } from "../lib/cod-filters.js";

const DAY = 24 * 60 * 60 * 1000;

/* ---------- writes from webhooks ---------- */

export async function upsertOrderFromWebhook(shop, payload, countryCode) {
  const rec = orderRecordFromWebhook(payload, countryCode);
  const existing = await prisma.order.findUnique({
    where: { shop_shopifyOrderId: { shop, shopifyOrderId: rec.shopifyOrderId } },
  });
  const tokenFields =
    rec.isCod && !existing?.confirmToken ? { confirmToken: generateToken(), tokenExpiresAt: tokenExpiry() } : {};

  const order = await prisma.order.upsert({
    where: { shop_shopifyOrderId: { shop, shopifyOrderId: rec.shopifyOrderId } },
    update: { ...rec, ...tokenFields },
    create: { shop, ...rec, ...tokenFields },
  });

  // A checkout that turned into an order is no longer abandoned.
  if (rec.checkoutToken) {
    const chk = await prisma.checkout.findUnique({ where: { shop_token: { shop, token: rec.checkoutToken } } });
    if (chk) {
      await prisma.checkout.update({
        where: { id: chk.id },
        data: { completed: true, recovered: chk.status === "sent" },
      });
    }
  }
  return order;
}

export async function upsertCheckoutFromWebhook(shop, payload, countryCode) {
  const rec = checkoutRecordFromWebhook(payload, countryCode);
  // Retention: abandoned checkouts are only useful for a few days; drop anything older than 30.
  await prisma.checkout.deleteMany({ where: { shop, createdAt: { lt: new Date(Date.now() - 30 * DAY) } } });
  return prisma.checkout.upsert({
    where: { shop_token: { shop, token: rec.token } },
    update: rec,
    create: { shop, ...rec },
  });
}

export async function applyFulfillment(shop, payload) {
  const f = trackingFromFulfillment(payload);
  const order = await prisma.order.findUnique({
    where: { shop_shopifyOrderId: { shop, shopifyOrderId: f.shopifyOrderId } },
  });
  if (!order) return null; // order placed before the app was installed
  const data = { trackingUrl: f.trackingUrl || order.trackingUrl, shippedAt: order.shippedAt || new Date() };
  if (f.status === "delivered" && !order.deliveredAt) data.deliveredAt = new Date();
  return prisma.order.update({ where: { id: order.id }, data });
}

/* ---------- queues ---------- */

export { COD_FILTERS };

export async function codQueue(shop, filter = "todo", { risk = null } = {}) {
  const f = COD_FILTERS[filter] || COD_FILTERS.todo;
  return prisma.order.findMany({
    where: { shop, isCod: true, ...f.where, ...(risk ? { riskLevel: risk } : {}) },
    orderBy: { createdAt: filter === "todo" ? "asc" : "desc" },
    take: 100,
  });
}

/**
 * MongoDB keeps "never set" and "null" apart, and Prisma leaves unset optional fields out of the
 * document. This matches both, e.g. orders whose shipping message hasn't been sent yet.
 */
const empty = (field) => ({ OR: [{ [field]: null }, { [field]: { isSet: false } }] });

export async function cartQueue(shop, { delayMin = 30, filter = "todo" } = {}) {
  const cutoff = new Date(Date.now() - delayMin * 60 * 1000);
  const base = { shop, completed: false, phone: { not: null } };
  const where =
    filter === "sent"
      ? { shop, status: "sent" }
      : filter === "recovered"
        ? { shop, recovered: true }
        : { ...base, status: "pending", updatedAt: { lte: cutoff }, createdAt: { gte: new Date(Date.now() - 7 * DAY) } };
  return prisma.checkout.findMany({ where, orderBy: { updatedAt: "desc" }, take: 100 });
}

export async function updatesQueue(shop, filter = "shipped") {
  const where =
    filter === "delivered"
      ? { shop, deliveredAt: { not: null }, AND: [empty("deliveredMsgSentAt")] }
      : filter === "done"
        ? { shop, OR: [{ shippedMsgSentAt: { not: null } }, { deliveredMsgSentAt: { not: null } }] }
        : { shop, shippedAt: { not: null }, AND: [empty("shippedMsgSentAt")] };
  return prisma.order.findMany({ where, orderBy: { updatedAt: "desc" }, take: 100 });
}

/* ---------- status changes ---------- */

/** Record that a message was opened in WhatsApp (for message analytics). */
export async function logSend(shop, { kind, refId, templateId, templateName = "", lang = "en" }) {
  return prisma.messageLog.create({
    data: { shop, kind, refId, templateId: templateId || null, templateName, lang, day: new Date().toISOString().slice(0, 10) },
  });
}

export async function markCodSent(shop, id, templateId = null) {
  await prisma.order.updateMany({ where: { id, shop }, data: { codTemplateId: templateId } });
  return prisma.order.updateMany({ where: { id, shop, codStatus: "pending" }, data: { codStatus: "sent", codSentAt: new Date() } });
}

export async function setCodStatus(shop, id, status, by = "merchant") {
  if (!["pending", "sent", "confirmed", "cancelled", "no_reply"].includes(status)) throw new Error("bad status");
  const responded = ["confirmed", "cancelled"].includes(status);
  await prisma.order.updateMany({
    where: { id, shop },
    data: { codStatus: status, ...(responded ? { codRespondedAt: new Date(), codRespondedBy: by } : {}) },
  });
  return prisma.order.findFirst({ where: { id, shop } });
}

export async function markCheckoutSent(shop, id, templateId = null) {
  return prisma.checkout.updateMany({ where: { id, shop }, data: { status: "sent", sentAt: new Date(), templateId } });
}
export async function dismissCheckout(shop, id) {
  return prisma.checkout.updateMany({ where: { id, shop }, data: { status: "dismissed" } });
}
export async function markUpdateSent(shop, id, kind) {
  const field = kind === "delivered" ? "deliveredMsgSentAt" : "shippedMsgSentAt";
  return prisma.order.updateMany({ where: { id, shop }, data: { [field]: new Date() } });
}
export async function markDelivered(shop, id) {
  return prisma.order.updateMany({ where: { id, shop, AND: [empty("deliveredAt")] }, data: { deliveredAt: new Date() } });
}

/* ---------- public confirm page ---------- */

export async function findByToken(token) {
  const order = await prisma.order.findFirst({ where: { confirmToken: token } });
  if (!order) return null;
  if (order.tokenExpiresAt && order.tokenExpiresAt < new Date()) return { ...order, expired: true };
  return order;
}

/* ---------- stats ---------- */

export async function dashboardStats(shop) {
  const since = new Date(Date.now() - 30 * DAY);
  const [codTodo, codWaiting, confirmed, cancelled, cartsSent, recovered, updatesTodo, clicks] = await Promise.all([
    prisma.order.count({ where: { shop, isCod: true, codStatus: "pending" } }),
    prisma.order.count({ where: { shop, isCod: true, codStatus: "sent" } }),
    prisma.order.count({ where: { shop, codStatus: "confirmed", codRespondedAt: { gte: since } } }),
    prisma.order.count({ where: { shop, codStatus: "cancelled", codRespondedAt: { gte: since } } }),
    prisma.checkout.count({ where: { shop, status: "sent", sentAt: { gte: since } } }),
    prisma.checkout.count({ where: { shop, recovered: true, updatedAt: { gte: since } } }),
    prisma.order.count({
      where: {
        shop,
        OR: [
          { shippedAt: { not: null }, AND: [empty("shippedMsgSentAt")] },
          { deliveredAt: { not: null }, AND: [empty("deliveredMsgSentAt")] },
        ],
      },
    }),
    prisma.widgetEvent.groupBy({
      by: ["widget"],
      where: { shop, event: { in: ["click", "copy", "apply"] }, day: { gte: since.toISOString().slice(0, 10) } },
      _sum: { count: true },
    }),
  ]);
  const clicksByType = Object.fromEntries(clicks.map((c) => [c.widget, c._sum.count || 0]));
  return { codTodo, codWaiting, confirmed, cancelled, cartsSent, recovered, updatesTodo, clicksByType };
}

/* ---------- privacy ---------- */

export async function redactCustomer(shop, { phone, orderIds = [] }) {
  const ids = orderIds.map(String);
  await prisma.order.deleteMany({ where: { shop, OR: [{ shopifyOrderId: { in: ids } }, ...(phone ? [{ phone }] : [])] } });
  if (phone) await prisma.checkout.deleteMany({ where: { shop, phone } });
}

/** Everything PingZest stores about one customer, for a data request (no internal ids or tokens). */
export async function customerData(shop, { phone, orderIds = [] }) {
  const ids = orderIds.map(String);
  const orders = await prisma.order.findMany({
    where: { shop, OR: [{ shopifyOrderId: { in: ids } }, ...(phone ? [{ phone }] : [])] },
    select: {
      id: true, shopifyOrderId: true, orderName: true, customerName: true, phone: true, totalPrice: true, currency: true,
      itemsSummary: true, isCod: true, codStatus: true, codSentAt: true, codRespondedAt: true, codRespondedBy: true,
      whatsappOptIn: true, discountCodes: true, trackingUrl: true, shippedAt: true, deliveredAt: true,
      shippedMsgSentAt: true, deliveredMsgSentAt: true, createdAt: true,
    },
  });
  const checkouts = phone
    ? await prisma.checkout.findMany({
        where: { shop, phone },
        select: { id: true, customerName: true, phone: true, totalPrice: true, currency: true, itemsSummary: true, status: true, sentAt: true, recovered: true, createdAt: true },
      })
    : [];
  const refIds = [...orders.map((o) => o.id), ...checkouts.map((c) => c.id)];
  const messages = refIds.length
    ? await prisma.messageLog.findMany({ where: { shop, refId: { in: refIds } }, select: { kind: true, templateName: true, lang: true, sentAt: true } })
    : [];
  const strip = ({ id, ...rest }) => rest;
  return { orders: orders.map(strip), checkouts: checkouts.map(strip), messages };
}

export async function deleteShopData(shop) {
  await prisma.$transaction([
    prisma.order.deleteMany({ where: { shop } }),
    prisma.checkout.deleteMany({ where: { shop } }),
    prisma.widgetEvent.deleteMany({ where: { shop } }),
    prisma.messageTemplate.deleteMany({ where: { shop } }),
    prisma.messageLog.deleteMany({ where: { shop } }),
    prisma.shopSettings.deleteMany({ where: { shop } }),
    prisma.widgetConfig.deleteMany({ where: { shop } }),
    prisma.discount.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
    // Keep the privacy log itself (proof the request was handled) but drop any customer data in it.
    prisma.complianceRequest.updateMany({ where: { shop }, data: { data: null } }),
  ]);
}

/* ---------- message analytics ---------- */

export async function messageAnalytics(shop, days = 30) {
  const { computeMessageStats, dayRange } = await import("../lib/message-stats.js");
  const since = dayRange(days)[0];
  const sinceDate = new Date(`${since}T00:00:00Z`);
  const [logs, orders, checkouts, templates] = await Promise.all([
    prisma.messageLog.findMany({ where: { shop, day: { gte: since } }, select: { kind: true, templateId: true, templateName: true, day: true } }),
    prisma.order.findMany({
      where: { shop, isCod: true, codSentAt: { gte: sinceDate } },
      select: { isCod: true, codStatus: true, codSentAt: true, codRespondedAt: true, codRespondedBy: true, codTemplateId: true },
    }),
    prisma.checkout.findMany({
      where: { shop, sentAt: { gte: sinceDate } },
      select: { status: true, sentAt: true, recovered: true, totalPrice: true, currency: true, templateId: true },
    }),
    prisma.messageTemplate.findMany({ where: { shop }, select: { id: true, name: true } }),
  ]);
  return computeMessageStats({ logs, orders, checkouts, templates, days });
}
