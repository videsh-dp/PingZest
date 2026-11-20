/**
 * COD risk score (Pro). Pure functions, unit-tested.
 *
 * Every COD order gets a score from 0 to 100 and a level (low / medium / high) with the reasons,
 * so the merchant can call the customer or ask for prepaid before shipping something that will
 * come back. Signals come from the store's own history in PingZest plus simple checks on the
 * address. The full address is never stored: only the PIN code and yes/no flags.
 */
import { N_ } from "../i18n/core.js";

export const LEVELS = { high: 60, medium: 30 };

/** Reason codes → text shown to the merchant (translated in the UI). */
export const REASONS = {
  no_phone: N_("No valid phone number"),
  phone_cancelled: N_("This number cancelled {count} COD order(s) before"),
  phone_no_reply: N_("This number didn't reply to a COD confirmation before"),
  phone_good: N_("This number confirmed {count} COD order(s) before"),
  phone_burst: N_("{count} orders from this number in 24 hours"),
  pin_cancel_rate: N_("PIN code {pin}: {rate} of COD orders cancelled"),
  high_value: N_("Order value is {times}× your usual COD order"),
  address_short: N_("Address looks incomplete"),
  address_no_number: N_("No house or flat number in the address"),
  address_fake: N_("Address looks fake or like a test"),
  pin_invalid: N_("PIN code looks invalid"),
  name_fake: N_("Customer name looks fake"),
  big_quantity: N_("Unusually large quantity ({count} of one item)"),
};

const FAKE_WORDS = /\b(test|testing|fake|dummy|asdf|qwerty|xyz|abc|na|n\/a|nil|none|sample|unknown)\b/i;

/**
 * Yes/no checks on a Shopify shipping address (address1, address2, zip, country_code, name…).
 * Returns { pincode, flags: ["address_short", …] } — nothing else from the address is kept.
 */
export function addressSignals(addr) {
  if (!addr) return { pincode: null, flags: ["address_short"] };
  const line = [addr.address1, addr.address2].filter(Boolean).join(" ").trim();
  const zip = String(addr.zip || "").replace(/\s/g, "");
  const country = String(addr.country_code || addr.countryCode || "").toUpperCase();
  const flags = [];
  const letters = line.replace(/[^\p{L}]/gu, "");
  if (line.length < 15 || letters.length < 8) flags.push("address_short");
  if (line && !/\d/.test(line)) flags.push("address_no_number");
  if (FAKE_WORDS.test(line) || /(.)\1{4,}/.test(line) || /^[\d\s,.-]+$/.test(line)) flags.push("address_fake");
  if (country === "IN" && !/^[1-9]\d{5}$/.test(zip)) flags.push("pin_invalid");
  const name = String(addr.name || [addr.first_name, addr.last_name].filter(Boolean).join(" ")).trim();
  if (name && (name.replace(/[^\p{L}]/gu, "").length < 2 || FAKE_WORDS.test(name))) flags.push("name_fake");
  return { pincode: zip || null, flags };
}

/**
 * order:   { totalPrice, phone, pincode, addressFlags: [], maxQuantity }
 * history: { phoneCancelled, phoneNoReply, phoneConfirmed, phoneOrders24h, pinOrders, pinCancelled,
 *            medianTotal, shopOrders } — counts of earlier COD orders in this store.
 * Returns { score, level, reasons: [{ code, vars }] } (reasons sorted by weight).
 */
export function scoreOrder(order, history = {}) {
  const found = [];
  const add = (code, weight, vars = {}) => found.push({ code, weight, vars });
  const h = { phoneCancelled: 0, phoneNoReply: 0, phoneConfirmed: 0, phoneOrders24h: 0, pinOrders: 0, pinCancelled: 0, medianTotal: 0, shopOrders: 0, ...history };

  if (!order.phone) add("no_phone", 35);
  if (h.phoneCancelled > 0) add("phone_cancelled", Math.min(45, 30 + (h.phoneCancelled - 1) * 10), { count: h.phoneCancelled });
  if (h.phoneNoReply > 0) add("phone_no_reply", 15);
  if (h.phoneConfirmed > 0 && h.phoneCancelled === 0) add("phone_good", -Math.min(30, 15 * h.phoneConfirmed), { count: h.phoneConfirmed });
  if (h.phoneOrders24h >= 2) add("phone_burst", 20, { count: h.phoneOrders24h + 1 });

  if (order.pincode && h.pinOrders >= 5) {
    const rate = h.pinCancelled / h.pinOrders;
    const vars = { pin: order.pincode, rate: `${Math.round(rate * 100)}%` };
    if (rate >= 0.4) add("pin_cancel_rate", 20, vars);
    else if (rate >= 0.25) add("pin_cancel_rate", 10, vars);
  }

  const total = Number(order.totalPrice) || 0;
  if (h.shopOrders >= 10 && h.medianTotal > 0 && total >= 3 * h.medianTotal) {
    add("high_value", total >= 6 * h.medianTotal ? 25 : 15, { times: Math.round((total / h.medianTotal) * 10) / 10 });
  }

  const weights = { address_short: 15, address_no_number: 10, address_fake: 25, pin_invalid: 15, name_fake: 10 };
  for (const f of order.addressFlags || []) if (weights[f]) add(f, weights[f]);
  if ((order.maxQuantity || 0) >= 5) add("big_quantity", 10, { count: order.maxQuantity });

  const score = Math.max(0, Math.min(100, found.reduce((s, r) => s + r.weight, 0)));
  const level = score >= LEVELS.high ? "high" : score >= LEVELS.medium ? "medium" : "low";
  const reasons = found.sort((a, b) => b.weight - a.weight).map(({ code, vars }) => ({ code, vars }));
  return { score, level, reasons };
}

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Largest quantity of a single line item in a webhook payload. */
export function maxQuantity(lineItems) {
  return (lineItems || []).reduce((m, li) => Math.max(m, Number(li?.quantity) || 0), 0);
}
