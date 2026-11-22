/**
 * Activity of one COD order, oldest first, built from what PingZest already stores (order fields and the
 * message log): no extra writes. Each event: { at, kind, by?, text, vars?, tone? }.
 */
import { N_ } from "../i18n/core.js";
import { parseActionError } from "./cod-loop.js";

const KIND_TEXT = {
  created: N_("Order placed"),
  held: N_("Fulfillment put on hold"),
  sent: N_("Confirmation opened in WhatsApp ({template})"),
  reminded: N_("Reminder opened in WhatsApp ({template})"),
  confirmed: N_("Confirmed"),
  cancelled: N_("Cancelled"),
  no_reply: N_("Expired without a reply"),
  released: N_("Hold released"),
  address: N_("Customer fixed the delivery address"),
  prepaidOffered: N_("Customer opened the online payment"),
  paid: N_("Paid online"),
  shopifyCancelled: N_("Cancelled in Shopify"),
  shipped: N_("Shipped"),
  delivered: N_("Delivered"),
  rto: N_("Returned to you (RTO)"),
  error: N_("Shopify action failed: {message}"),
};

export function buildTimeline(order, logs = []) {
  const ev = [];
  const add = (at, kind, extra = {}) => { if (at) ev.push({ at: new Date(at).toISOString(), kind, text: KIND_TEXT[kind], ...extra }); };
  add(order.createdAt, "created");
  add(order.heldAt, "held");
  const sends = logs.filter((l) => l.kind === "cod_confirm" || l.kind === "cod_reminder");
  for (const l of sends) add(l.sentAt, l.kind === "cod_reminder" ? "reminded" : "sent", { vars: { template: l.templateName || "Standard" } });
  // Older orders may have no log entry for the send.
  if (order.codSentAt && !sends.some((l) => l.kind === "cod_confirm")) add(order.codSentAt, "sent", { vars: { template: "—" } });
  if (order.codRemindedAt && !sends.some((l) => l.kind === "cod_reminder")) add(order.codRemindedAt, "reminded", { vars: { template: "—" } });
  add(order.addressUpdatedAt, "address", { by: "customer" });
  add(order.prepaidOfferedAt, "prepaidOffered", { by: "customer" });
  add(order.paidAt, "paid", { by: "customer", tone: "success" });
  if (order.codStatus === "confirmed") add(order.codRespondedAt, "confirmed", { by: order.codRespondedBy || null, tone: "success" });
  if (order.codStatus === "cancelled") add(order.codRespondedAt, "cancelled", { by: order.codRespondedBy || null, tone: "critical" });
  if (order.codStatus === "no_reply") add(order.codExpiredAt || order.codRespondedAt, "no_reply", { by: order.codRespondedBy === "merchant" ? "merchant" : "auto" });
  add(order.holdReleasedAt, "released");
  add(order.shopifyCancelledAt, "shopifyCancelled", { tone: "critical" });
  add(order.shippedAt, "shipped");
  add(order.deliveredAt, "delivered");
  add(order.rtoAt, "rto", { tone: "critical" });
  if (order.actionError) {
    const e = parseActionError(order.actionError);
    add(order.actionErrorAt || order.updatedAt, "error", { vars: { message: e.message }, tone: "critical", errorKind: e.kind });
  }
  return ev.sort((a, b) => a.at.localeCompare(b.at));
}
