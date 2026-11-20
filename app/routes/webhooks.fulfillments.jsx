import { authenticate } from "../shopify.server";
import { applyFulfillment } from "../models/orders.server";

// fulfillments/create and fulfillments/update: feeds the "shipped" and "delivered" queues.
export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);
  await applyFulfillment(shop, payload);
  return new Response();
};
