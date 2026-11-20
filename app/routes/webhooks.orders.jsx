import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { upsertOrderFromWebhook } from "../models/orders.server";
import { fetchOrderAsPayload } from "../models/shopify-admin.server";
import { pickPhone } from "../lib/orders.js";

// orders/create: store the order; COD orders get a confirm link token.
export const action = async ({ request }) => {
  const { shop, payload, admin } = await authenticate.webhook(request);
  const settings = await getSettings(shop);

  let data = payload;
  // Customer fields can be redacted in webhooks: fetch the order if we got no phone.
  if (!pickPhone(payload, settings.countryCode) && admin) {
    try {
      const fetched = await fetchOrderAsPayload(admin, payload.admin_graphql_api_id);
      if (fetched) data = { ...payload, ...fetched };
    } catch (e) {
      console.error("Could not fetch order details", e);
    }
  }

  await upsertOrderFromWebhook(shop, data, settings.countryCode);
  return new Response();
};
