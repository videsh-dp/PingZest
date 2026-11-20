/**
 * COD → prepaid offer (Pro): when it can be shown and how big the discount is. Pure, unit-tested.
 */

/** Discount for paying online: percent of the items subtotal, capped at maxAmount (0 = no cap). */
export function prepaidDiscount(subtotal, percent, maxAmount = 0) {
  const s = Number(subtotal) || 0;
  const p = Number(percent) || 0;
  if (s <= 0 || p <= 0) return 0;
  const raw = (s * p) / 100;
  const capped = maxAmount > 0 ? Math.min(raw, maxAmount) : raw;
  return Math.floor(capped * 100) / 100;
}

/**
 * Can the confirm page offer online payment for this order?
 * live: the order as read from Shopify (fetchOrderForConfirm).
 */
export function canOfferPrepaid(order, live) {
  if (!order?.isCod || order.convertedToPrepaid || order.paidAt || order.shippedAt) return false;
  if (order.codStatus === "cancelled") return false;
  if (!live || live.cancelledAt) return false;
  const status = String(live.displayFinancialStatus || "").toUpperCase();
  if (!["PENDING", "PARTIALLY_PAID", "AUTHORIZED"].includes(status)) return false;
  if (!live.paymentCollectionDetails?.additionalPaymentCollectionUrl) return false;
  return Number(live.totalOutstandingSet?.shopMoney?.amount || 0) > 0;
}

/** Clean the address form from the confirm page; returns { address } or { error }. */
export function cleanAddressForm(form, countryCode) {
  const t = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const address = { address1: t(form.address1, 120), address2: t(form.address2, 120), city: t(form.city, 60), zip: t(form.zip, 12).replace(/\s/g, "") };
  if (address.address1.length < 5) return { error: "address1" };
  if (!address.city) return { error: "city" };
  if (String(countryCode).toUpperCase() === "IN" ? !/^[1-9]\d{5}$/.test(address.zip) : !address.zip) return { error: "zip" };
  return { address };
}
