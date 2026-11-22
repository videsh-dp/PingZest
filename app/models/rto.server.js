/**
 * Returns (RTO) analytics from the store's COD orders (docs/TICKETS.md PZ-04, PZ-05).
 * The maths is in app/lib/rto.js; this file only loads rows.
 */
import prisma from "../db.server";
import { rtoCostFor, savings, rtoBreakdowns } from "../lib/rto.js";

const DAY = 86400000;
const ROW = {
  codStatus: true, shippedAt: true, rtoAt: true, convertedToPrepaid: true, pincode: true, firstOrder: true,
  placedHour: true, discountCodes: true, currency: true,
};

/** The store's currency, from its latest order (Shopify orders carry the shop currency). */
export async function shopCurrency(shop) {
  const o = await prisma.order.findFirst({ where: { shop }, orderBy: { createdAt: "desc" }, select: { currency: true } });
  return o?.currency || "INR";
}

async function codOrders(shop, days) {
  return prisma.order.findMany({
    where: { shop, isCod: true, createdAt: { gte: new Date(Date.now() - days * DAY) } },
    select: ROW,
    orderBy: { createdAt: "desc" },
    take: 10000,
  });
}

/** Headline only (Home, Plan, Free): parcels not shipped and money saved. */
export async function savedSummary(shop, settings, days = 30) {
  const orders = await codOrders(shop, days);
  const currency = orders[0]?.currency || (await shopCurrency(shop));
  const cost = rtoCostFor(settings?.rtoCost, currency);
  return { days, currency, costIsDefault: settings?.rtoCost == null, total: orders.length, ...savings(orders, cost) };
}

/** Headline + breakdowns. Breakdowns are left out unless `withBreakdowns` (Pro), so Free pages never get them. */
export async function returnsAnalytics(shop, settings, days = 30, { withBreakdowns = false } = {}) {
  const orders = await codOrders(shop, days);
  const currency = orders[0]?.currency || (await shopCurrency(shop));
  const cost = rtoCostFor(settings?.rtoCost, currency);
  const b = rtoBreakdowns(orders);
  return {
    days, currency, costIsDefault: settings?.rtoCost == null, total: orders.length,
    ...savings(orders, cost),
    rto: { shipped: b.all.shipped, returned: b.all.rto, rate: b.all.rtoRate },
    breakdowns: withBreakdowns ? b : null,
  };
}

/** The merchant marks a parcel as returned to origin (or undoes it). */
export async function markRto(shop, id, returned) {
  return prisma.order.updateMany({ where: { id, shop, isCod: true }, data: { rtoAt: returned ? new Date() : null } });
}
