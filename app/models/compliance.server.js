/**
 * Privacy webhooks log (MongoDB collection ComplianceRequest).
 * Data requests are stored as "pending" with the customer's data, ready to send to the merchant.
 */
import prisma from "../db.server";

export const TOPICS = {
  CUSTOMERS_DATA_REQUEST: "customers/data_request",
  CUSTOMERS_REDACT: "customers/redact",
  SHOP_REDACT: "shop/redact",
};

/** True if this webhook delivery was already stored (Shopify retries until it gets a 200). */
export async function alreadyLogged(webhookId) {
  if (!webhookId) return false;
  return Boolean(await prisma.complianceRequest.findFirst({ where: { webhookId }, select: { id: true } }));
}

export function summarize(data) {
  const n = (a) => (Array.isArray(a) ? a.length : 0);
  const parts = [];
  parts.push(`${n(data?.orders)} order${n(data?.orders) === 1 ? "" : "s"}`);
  parts.push(`${n(data?.checkouts)} checkout${n(data?.checkouts) === 1 ? "" : "s"}`);
  parts.push(`${n(data?.messages)} message${n(data?.messages) === 1 ? "" : "s"}`);
  return parts.join(", ");
}

export async function logComplianceRequest({ shop, topic, webhookId, payload, data = null, status = "done", note = "" }) {
  return prisma.complianceRequest.create({
    data: {
      shop,
      topic: TOPICS[topic] || String(topic),
      webhookId: webhookId || null,
      requestId: payload?.data_request?.id != null ? String(payload.data_request.id) : null,
      shopifyCustomerId: payload?.customer?.id != null ? String(payload.customer.id) : null,
      ordersRequested: (payload?.orders_requested || payload?.orders_to_redact || []).map(String),
      status,
      data,
      summary: data ? summarize(data) : "",
      handledAt: status === "done" ? new Date() : null,
      note,
    },
  });
}

/** A customer asked to be deleted: their data must not linger in earlier, unsent data requests. */
export async function clearCustomerFromRequests(shop, shopifyCustomerId) {
  if (!shopifyCustomerId) return;
  await prisma.complianceRequest.updateMany({
    where: { shop, topic: TOPICS.CUSTOMERS_DATA_REQUEST, shopifyCustomerId: String(shopifyCustomerId) },
    data: { data: null, status: "redacted", note: "Customer data deleted after a redact request." },
  });
}

/** For the future email step (and for checking by hand): open data requests, oldest first. */
export function pendingDataRequests(limit = 50) {
  return prisma.complianceRequest.findMany({
    where: { topic: TOPICS.CUSTOMERS_DATA_REQUEST, status: "pending" },
    orderBy: { receivedAt: "asc" },
    take: limit,
  });
}

export function markDataRequestSent(id, note = "Sent to merchant") {
  return prisma.complianceRequest.update({ where: { id }, data: { status: "done", handledAt: new Date(), note } });
}
