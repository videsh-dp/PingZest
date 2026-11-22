import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { upsertOrderFromWebhook } from "../models/orders.server";
import { fetchOrderAsPayload } from "../models/shopify-admin.server";
import { pickPhone } from "../lib/orders.js";
import { assessOrder } from "../models/risk.server";
import { holdCodOrder, processDueCod } from "../models/cod-loop.server";

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

  const order = await upsertOrderFromWebhook(shop, data, settings.countryCode);
  try {
    await assessOrder(shop, order, data, admin); // COD risk score
  } catch (e) {
    console.error("risk score failed", e?.message);
  }
  if (order.isCod && admin) {
    await holdCodOrder(order, admin, settings); // until the customer confirms (Settings → Orders)
    await processDueCod(shop, admin, { limit: 10 }).catch((e) => console.error("COD autopilot failed", e?.message));
  }
  return new Response();
};
