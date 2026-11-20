/**
 * Widget settings (stored in our DB + synced to the shop metafield) and widget analytics.
 */
import prisma from "../db.server";
import { defaultConfig, sanitizeConfig } from "../lib/widget-config.js";
import { syncConfigMetafield } from "./shopify-admin.server";
import { getSettings } from "./settings.server";
import { hasFeature, planOf } from "../lib/plans.js";

const DAY = 24 * 60 * 60 * 1000;

export async function getWidgetConfig(shop) {
  const row = await prisma.widgetConfig.findUnique({ where: { shop } });
  if (!row) return { config: defaultConfig(), syncedAt: null, syncError: null };
  let parsed = null;
  try { parsed = JSON.parse(row.config); } catch { /* fall back to defaults */ }
  return { config: sanitizeConfig(parsed), syncedAt: row.syncedAt, syncError: row.syncError };
}

/**
 * Validate, store, and push to the storefront metafield.
 * Returns { config, synced: boolean, error? }
 */
export async function saveWidgetConfig(shop, admin, input) {
  const config = sanitizeConfig(input);
  let syncError = null;
  try {
    await syncConfigMetafield(admin, await forStorefront(shop, config));
  } catch (e) {
    syncError = e?.message || "Could not save to your store";
    console.error("metafield sync failed", syncError);
  }
  const data = { config: JSON.stringify(config), syncError, ...(syncError ? {} : { syncedAt: new Date() }) };
  await prisma.widgetConfig.upsert({ where: { shop }, update: data, create: { shop, ...data } });
  return { config, synced: !syncError, error: syncError };
}

/** What the storefront gets: the config plus plan-dependent bits (the Free plan shows "Powered by PingZest"). */
async function forStorefront(shop, config) {
  const settings = await getSettings(shop);
  return {
    ...config,
    branding: !hasFeature(planOf(settings), "noBranding"),
    brandingUrl: process.env.PINGZEST_BRAND_URL || "https://apps.shopify.com/pingzest",
  };
}

/** Push the stored config again, e.g. after a plan change. */
export async function resyncWidgets(shop, admin) {
  const { config } = await getWidgetConfig(shop);
  return saveWidgetConfig(shop, admin, config);
}

/* ---------- events from the storefront ---------- */

const WIDGETS = ["chat", "discount", "product", "cart", "share"];
const EVENTS = ["view", "click", "copy", "apply"];
const PAGE_TYPES = ["index", "product", "collection", "list-collections", "cart", "search", "page", "blog", "article", "404"];

/** body: { pageType, device, events: [{ widget, event }] } — at most 10 events per request. */
export async function recordEvents(shop, body) {
  const pageType = PAGE_TYPES.includes(body?.pageType) ? body.pageType : "other";
  const device = body?.device === "mobile" ? "mobile" : "desktop";
  const day = new Date().toISOString().slice(0, 10);
  const events = (Array.isArray(body?.events) ? body.events : [])
    .slice(0, 10)
    .filter((e) => WIDGETS.includes(e?.widget) && EVENTS.includes(e?.event));
  for (const { widget, event } of events) {
    await prisma.widgetEvent.upsert({
      where: { shop_widget_event_pageType_device_day: { shop, widget, event, pageType, device, day } },
      update: { count: { increment: 1 } },
      create: { shop, widget, event, pageType, device, day, count: 1 },
    });
  }
  return events.length;
}

/* ---------- analytics ---------- */

function daysBack(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.now() - i * DAY).toISOString().slice(0, 10));
  return out;
}

export async function widgetAnalytics(shop, days = 30) {
  const range = daysBack(days);
  const since = range[0];
  const rows = await prisma.widgetEvent.findMany({ where: { shop, day: { gte: since } } });

  const totals = {}; // widget -> {view, click, copy, apply}
  const daily = Object.fromEntries(range.map((d) => [d, { view: 0, click: 0 }]));
  const byDevice = { desktop: { view: 0, click: 0 }, mobile: { view: 0, click: 0 } };
  const byPage = {}; // pageType -> {view, click}

  for (const r of rows) {
    totals[r.widget] ??= { view: 0, click: 0, copy: 0, apply: 0 };
    totals[r.widget][r.event] += r.count;
    // copies and applies count as clicks in the daily / device / page breakdowns
    const bucket = r.event === "view" ? "view" : "click";
    if (daily[r.day]) daily[r.day][bucket] += r.count;
    byDevice[r.device][bucket] += r.count;
    byPage[r.pageType] ??= { view: 0, click: 0 };
    byPage[r.pageType][bucket] += r.count;
  }

  // Orders that used one of the shop's banner/app discount codes
  const discounts = await prisma.discount.findMany({ where: { shop }, select: { code: true } });
  const codes = new Set(discounts.map((d) => d.code.toUpperCase()));
  const orders = codes.size
    ? await prisma.order.findMany({
        where: { shop, createdAt: { gte: new Date(`${since}T00:00:00Z`) }, NOT: { discountCodes: "" } },
        select: { discountCodes: true, totalPrice: true, discountAmount: true, currency: true },
      })
    : [];
  const byCode = {};
  let revenue = 0, discountGiven = 0, orderCount = 0, currency = null;
  for (const o of orders) {
    const used = o.discountCodes.split(",").filter((c) => codes.has(c));
    if (!used.length) continue;
    orderCount += 1;
    revenue += Number(o.totalPrice) || 0;
    discountGiven += Number(o.discountAmount) || 0;
    currency ??= o.currency;
    for (const c of used) {
      byCode[c] ??= { orders: 0, revenue: 0 };
      byCode[c].orders += 1;
      byCode[c].revenue += Number(o.totalPrice) || 0;
    }
  }

  return {
    days,
    totals,
    daily: range.map((d) => ({ day: d, ...daily[d] })),
    byDevice,
    byPage,
    discountOrders: { orders: orderCount, revenue, discountGiven, currency: currency || "INR", byCode },
  };
}
