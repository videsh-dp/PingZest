/**
 * Helpers that turn Shopify webhook payloads (orders, checkouts, fulfillments)
 * into the small records and template variables the app works with.
 * Pure functions: no Shopify SDK, so they are unit-tested.
 */
import { normalizePhone } from "./phone.js";

const COD_PATTERN = /cash\s*on\s*delivery|\bcod\b|pay\s*on\s*delivery/i;

/** Does this order use Cash on Delivery? */
export function isCodOrder(order) {
  const names = [
    ...(order?.payment_gateway_names || []),
    order?.gateway,
    order?.payment_gateway,
  ].filter(Boolean);
  return names.some((n) => COD_PATTERN.test(String(n)));
}

/** Best available phone on an order or checkout, normalised. */
export function pickPhone(obj, defaultCountryCode = "91") {
  const candidates = [
    obj?.phone,
    obj?.shipping_address?.phone,
    obj?.billing_address?.phone,
    obj?.customer?.phone,
    obj?.customer?.default_address?.phone,
  ];
  for (const c of candidates) {
    const n = normalizePhone(c, defaultCountryCode);
    if (n) return n;
  }
  return null;
}

/** First name for greetings. */
export function pickFirstName(obj) {
  return (
    obj?.customer?.first_name ||
    obj?.shipping_address?.first_name ||
    obj?.billing_address?.first_name ||
    ""
  ).trim();
}

/** "₹1,299" style money; falls back gracefully for unknown currencies. */
export function formatMoney(amount, currency = "INR") {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** "2 × Blue Kurta, 1 × Dupatta (+2 more)" */
export function summariseItems(lineItems = [], max = 3) {
  const items = (lineItems || []).map((li) => `${li.quantity || 1} × ${li.title || li.name || "Item"}`);
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")} (+${items.length - max} more)`;
}

/** Normalise an orders/create payload into what we store. */
export function orderRecordFromWebhook(payload, defaultCountryCode = "91") {
  return {
    shopifyOrderId: String(payload.id),
    orderGid: payload.admin_graphql_api_id || `gid://shopify/Order/${payload.id}`,
    orderName: payload.name || `#${payload.order_number ?? payload.id}`,
    customerName: pickFirstName(payload),
    phone: pickPhone(payload, defaultCountryCode),
    totalPrice: String(payload.total_price ?? payload.current_total_price ?? "0"),
    currency: payload.currency || payload.presentment_currency || "INR",
    itemsSummary: summariseItems(payload.line_items),
    isCod: isCodOrder(payload),
    checkoutToken: payload.checkout_token || null,
    orderStatusUrl: payload.order_status_url || null,
    whatsappOptIn: hasWhatsappOptIn(payload),
    discountCodes: discountCodesOf(payload).join(","),
    discountAmount: String(payload.total_discounts ?? "0"),
  };
}

/** Codes used on an order, upper-cased: ["WELCOME10"] */
export function discountCodesOf(payload) {
  const list = (payload?.discount_codes || []).map((d) => (typeof d === "string" ? d : d?.code));
  return [...new Set(list.filter(Boolean).map((c) => String(c).trim().toUpperCase()))];
}

/** Normalise a checkouts/create|update payload. */
export function checkoutRecordFromWebhook(payload, defaultCountryCode = "91") {
  return {
    token: String(payload.token || payload.id),
    customerName: pickFirstName(payload),
    phone: pickPhone(payload, defaultCountryCode),
    totalPrice: String(payload.total_price ?? "0"),
    currency: payload.currency || payload.presentment_currency || "INR",
    itemsSummary: summariseItems(payload.line_items),
    checkoutUrl: payload.abandoned_checkout_url || null,
    completed: Boolean(payload.completed_at),
  };
}

/** Pull tracking info from a fulfillments/create payload. */
export function trackingFromFulfillment(payload) {
  const urls = payload.tracking_urls || (payload.tracking_url ? [payload.tracking_url] : []);
  return {
    shopifyOrderId: String(payload.order_id),
    trackingUrl: urls[0] || null,
    trackingNumber: (payload.tracking_numbers || [payload.tracking_number]).filter(Boolean)[0] || null,
    status: payload.shipment_status || payload.status || null, // "delivered" arrives on fulfillments/update
  };
}

/** Our cart-page opt-in checkbox stores a cart attribute that becomes an order note attribute. */
export function hasWhatsappOptIn(payload) {
  const attrs = payload?.note_attributes || [];
  return attrs.some((a) => /whatsapp.?updates/i.test(a.name || "") && /^(yes|true|1|on)$/i.test(String(a.value)));
}

/** A checkout counts as abandoned after `minutes` without completion. */
export function isAbandoned(checkout, now = new Date(), minutes = 30) {
  if (checkout.completed || checkout.recovered) return false;
  const updated = new Date(checkout.updatedAt || checkout.createdAt);
  return now - updated >= minutes * 60 * 1000;
}

/** Template variables for an order row. */
export function orderVars(order, { storeName, confirmLink, trackingLink } = {}) {
  return {
    name: order.customerName,
    order_no: order.orderName,
    amount: formatMoney(order.totalPrice, order.currency),
    items: order.itemsSummary,
    store_name: storeName,
    confirm_link: confirmLink,
    tracking_link: trackingLink ?? order.trackingUrl,
    order_status_link: order.orderStatusUrl,
  };
}

/** Template variables for a checkout row. */
export function checkoutVars(checkout, { storeName } = {}) {
  return {
    name: checkout.customerName,
    amount: formatMoney(checkout.totalPrice, checkout.currency),
    items: checkout.itemsSummary,
    store_name: storeName,
    checkout_link: checkout.checkoutUrl,
  };
}
