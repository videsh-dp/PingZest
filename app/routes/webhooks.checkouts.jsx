import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { upsertCheckoutFromWebhook } from "../models/orders.server";

// checkouts/create and checkouts/update: candidates for the abandoned checkout queue.
export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);
  const settings = await getSettings(shop);
  await upsertCheckoutFromWebhook(shop, payload, settings.countryCode);
  return new Response();
};
