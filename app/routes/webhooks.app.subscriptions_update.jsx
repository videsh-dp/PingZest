import { authenticate } from "../shopify.server";
import { applySubscriptionWebhook } from "../models/billing.server";

// app_subscriptions/update: the merchant subscribed, cancelled, or a payment failed (FROZEN).
export const action = async ({ request }) => {
  const { shop, payload, admin } = await authenticate.webhook(request);
  await applySubscriptionWebhook(shop, payload, admin);
  return new Response();
};
