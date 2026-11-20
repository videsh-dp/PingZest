import { authenticate } from "../shopify.server";
import { recordPaid } from "../models/prepaid.server";

// orders/paid: detects COD orders the customer paid online from the confirm page (COD → prepaid).
export const action = async ({ request }) => {
  const { shop, payload, admin } = await authenticate.webhook(request);
  await recordPaid(shop, payload, admin);
  return new Response();
};
