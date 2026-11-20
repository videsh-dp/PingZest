import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { redactCustomer, customerData, deleteShopData } from "../models/orders.server";
import { normalizePhone } from "../lib/phone.js";

/**
 * Mandatory privacy webhooks.
 * - customers/data_request: we log what we hold so you can send it to the merchant within 30 days.
 * - customers/redact: delete that customer's orders/checkouts from our database.
 * - shop/redact: delete everything for the shop (sent 48h after uninstall).
 */
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      const settings = await getSettings(shop);
      const phone = normalizePhone(payload.customer?.phone, settings.countryCode);
      const data = await customerData(shop, { phone, orderIds: payload.orders_requested || [] });
      // TODO before launch: email this to the merchant (shop owner) instead of only logging it.
      console.log(`[privacy] data request for ${shop}`, JSON.stringify(data));
      break;
    }
    case "CUSTOMERS_REDACT": {
      const settings = await getSettings(shop);
      const phone = normalizePhone(payload.customer?.phone, settings.countryCode);
      await redactCustomer(shop, { phone, orderIds: payload.orders_to_redact || [] });
      break;
    }
    case "SHOP_REDACT":
      await deleteShopData(shop);
      break;
    default:
      return new Response("Unhandled topic", { status: 404 });
  }
  return new Response();
};
