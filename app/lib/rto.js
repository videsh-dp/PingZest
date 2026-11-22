/**
 * Returns (RTO) analytics: what COD confirmation saved, and where returns come from.
 * Pure functions (unit-tested). Rows are COD orders: { codStatus, shippedAt, rtoAt, convertedToPrepaid,
 * pincode, firstOrder, placedHour, discountCodes, totalPrice, currency }.
 *
 * "Saved" counts parcels the merchant didn't have to ship and pay to get back: COD orders cancelled or
 * left unanswered and not shipped, plus orders switched to prepaid. Each is worth the merchant's own
 * average cost of a returned parcel (Settings → Orders), defaulting to ₹500 for INR stores (both-way
 * shipping, packing and lost ad spend on a ~₹1,200 order are put at ₹350–700 by COD vendors).
 */
import { N_ } from "../i18n/core.js";

export const DEFAULT_RTO_COST = { INR: 500 };
export const MIN_PIN_ORDERS = 3;

/** The merchant's cost per returned parcel, or the default for the currency (null = not set). */
export function rtoCostFor(setting, currency = "INR") {
  const n = Number(setting);
  if (setting !== null && setting !== undefined && setting !== "" && Number.isFinite(n) && n >= 0) return n;
  return DEFAULT_RTO_COST[currency] ?? null;
}

/** Form value → stored value: a number ≥ 0, or null to use the default. */
export function cleanRtoCost(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n * 100) / 100, 1_000_000) : null;
}

const shipped = (o) => Boolean(o.shippedAt || o.rtoAt);
/** A parcel the merchant didn't ship thanks to confirmation (or prepaid). */
export const isAvoided = (o) => Boolean(o.convertedToPrepaid || (["cancelled", "no_reply"].includes(o.codStatus) && !shipped(o)));

/** Headline: parcels avoided and money saved. */
export function savings(orders, cost) {
  const cancelled = orders.filter((o) => !o.convertedToPrepaid && isAvoided(o)).length;
  const prepaid = orders.filter((o) => o.convertedToPrepaid).length;
  const avoided = cancelled + prepaid;
  return { avoided, cancelled, prepaid, cost, saved: cost == null ? null : avoided * cost };
}

export const HOUR_BANDS = [
  { id: "night", from: 0, to: 5, label: N_("Night (12–6 am)") },
  { id: "morning", from: 6, to: 11, label: N_("Morning (6 am–12 pm)") },
  { id: "afternoon", from: 12, to: 17, label: N_("Afternoon (12–6 pm)") },
  { id: "evening", from: 18, to: 23, label: N_("Evening (6 pm–12 am)") },
];
export const bandOf = (hour) => (Number.isInteger(hour) ? HOUR_BANDS.find((b) => hour >= b.from && hour <= b.to)?.id : null) || "unknown";

/** Hour of day the order was placed, in the store's own time (from the ISO offset in created_at). */
export function placedHourOf(createdAt) {
  const m = /T(\d{2}):\d{2}/.exec(String(createdAt || ""));
  if (!m) return null;
  const h = parseInt(m[1], 10);
  return h >= 0 && h <= 23 ? h : null;
}

/** First order of this customer? From the webhook's customer.orders_count when Shopify sends it. */
export function firstOrderOf(payload) {
  const n = payload?.customer?.orders_count ?? payload?.customer?.number_of_orders;
  if (n === undefined || n === null || n === "") return null;
  const count = Number(n);
  return Number.isFinite(count) ? count <= 1 : null;
}

function emptyRow(key) {
  return { key, orders: 0, confirmed: 0, cancelled: 0, noReply: 0, shipped: 0, rto: 0 };
}
function add(row, o) {
  row.orders += 1;
  if (o.codStatus === "confirmed") row.confirmed += 1;
  if (o.codStatus === "cancelled") row.cancelled += 1;
  if (o.codStatus === "no_reply") row.noReply += 1;
  if (shipped(o)) row.shipped += 1;
  if (o.rtoAt) row.rto += 1;
}
const rate = (a, b) => (b ? a / b : null);
function finish(row) {
  return {
    ...row,
    cancelRate: rate(row.cancelled, row.orders),
    noReplyRate: rate(row.noReply, row.orders),
    rtoRate: rate(row.rto, row.shipped),
    // Share of orders that didn't turn into a kept sale: cancelled, unanswered or returned.
    lossRate: rate(row.cancelled + row.noReply + row.rto, row.orders),
  };
}
function groupBy(orders, keyOf, keys) {
  const rows = new Map((keys || []).map((k) => [k, emptyRow(k)]));
  for (const o of orders) {
    const k = keyOf(o);
    if (!rows.has(k)) rows.set(k, emptyRow(k));
    add(rows.get(k), o);
  }
  return [...rows.values()].map(finish);
}

/** All the cuts merchants ask for (R1 §1 job 2): PIN code, first-time buyer, coupon, order hour, confirmed vs not. */
export function rtoBreakdowns(orders) {
  const pincodes = groupBy(orders.filter((o) => o.pincode), (o) => o.pincode)
    .filter((r) => r.orders >= MIN_PIN_ORDERS)
    .sort((a, b) => (b.lossRate ?? 0) - (a.lossRate ?? 0) || b.orders - a.orders)
    .slice(0, 10);
  const firstTime = groupBy(orders, (o) => (o.firstOrder === true ? "first" : o.firstOrder === false ? "repeat" : "unknown"), ["first", "repeat"])
    .filter((r) => r.key !== "unknown" || r.orders > 0);
  const coupon = groupBy(orders, (o) => (String(o.discountCodes || "").trim() ? "coupon" : "none"), ["coupon", "none"]);
  const hours = groupBy(orders, (o) => bandOf(o.placedHour), [...HOUR_BANDS.map((b) => b.id)]).filter((r) => r.key !== "unknown" || r.orders > 0);
  // The key cut from the merchant thread: do confirmed orders come back less often?
  const confirmation = groupBy(orders.filter(shipped), (o) => (o.codStatus === "confirmed" || o.convertedToPrepaid ? "confirmed" : "unconfirmed"), ["confirmed", "unconfirmed"]);
  const all = finish(orders.reduce((row, o) => (add(row, o), row), emptyRow("all")));
  return { all, pincodes, firstTime, coupon, hours, confirmation };
}

/** CSV of the breakdowns (Pro "Export CSV"); labels come translated from the page. */
export function breakdownCsv(sections) {
  const esc = (v) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // no spreadsheet formulas
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const pct = (r) => (r == null ? "" : (Math.round(r * 1000) / 10).toFixed(1));
  const lines = [["section", "segment", "orders", "confirmed", "cancelled", "no_reply", "shipped", "returned", "cancel_pct", "no_reply_pct", "rto_pct"].join(",")];
  for (const { title, rows } of sections) {
    for (const r of rows) {
      lines.push([title, r.label ?? r.key, r.orders, r.confirmed, r.cancelled, r.noReply, r.shipped, r.rto, pct(r.cancelRate), pct(r.noReplyRate), pct(r.rtoRate)].map(esc).join(","));
    }
  }
  return lines.join("\n") + "\n";
}

/** Rough value of $1 in a few store currencies, only for the "pays for itself after N returns" line. */
const APPROX_PER_USD = { USD: 1, INR: 85 };

/**
 * How many prevented returns a month cover a monthly price in USD, in the store currency:
 * { count, price } or null when we can't say (unknown currency or cost).
 */
export function paybackReturns(cost, currency, priceUsd) {
  const rate = APPROX_PER_USD[currency];
  if (!rate || !(cost > 0) || !(priceUsd > 0)) return null;
  const price = Math.round(priceUsd * rate);
  return { count: Math.max(1, Math.ceil(price / cost)), price };
}
