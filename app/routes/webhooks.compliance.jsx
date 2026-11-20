import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { redactCustomer, customerData, deleteShopData } from "../models/orders.server";
import { alreadyLogged, logComplianceRequest, clearCustomerFromRequests } from "../models/compliance.server";
import { normalizePhone } from "../lib/phone.js";
import { capture } from "../posthog.server";

/**
 * Mandatory privacy webhooks. Every delivery is stored in the ComplianceRequest collection.
 * - customers/data_request: store what we hold as a "pending" request; send it to the merchant
 *   within 30 days (by hand for now, see README → Privacy requests).
 * - customers/redact: delete that customer's orders/checkouts from our database.
 * - shop/redact: delete everything for the shop (sent 48h after uninstall).
 * PostHog gets an event per request (no customer data) so you can set an alert on data requests.
 */
export const action = async ({ request }) => {
  const { shop, topic, payload, webhookId } = await authenticate.webhook(request);
  if (await alreadyLogged(webhookId)) return new Response(); // Shopify retry of a request we already stored

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      const settings = await getSettings(shop);
      const phone = normalizePhone(payload.customer?.phone, settings.countryCode);
      const data = await customerData(shop, { phone, orderIds: payload.orders_requested || [] });
      const row = await logComplianceRequest({ shop, topic, webhookId, payload, data, status: "pending" });
      capture("privacy_data_request", shop, { request_id: row.id, summary: row.summary, status: "pending" });
      break;
    }
    case "CUSTOMERS_REDACT": {
      const settings = await getSettings(shop);
      const phone = normalizePhone(payload.customer?.phone, settings.countryCode);
      await redactCustomer(shop, { phone, orderIds: payload.orders_to_redact || [] });
      await clearCustomerFromRequests(shop, payload.customer?.id);
      await logComplianceRequest({ shop, topic, webhookId, payload, note: "Customer orders and checkouts deleted." });
      capture("privacy_customer_redact", shop, {});
      break;
    }
    case "SHOP_REDACT":
      await deleteShopData(shop);
      await logComplianceRequest({ shop, topic, webhookId, payload, note: "All shop data deleted." });
      capture("privacy_shop_redact", shop, {});
      break;
    default:
      return new Response("Unhandled topic", { status: 404 });
  }
  return new Response();
};
