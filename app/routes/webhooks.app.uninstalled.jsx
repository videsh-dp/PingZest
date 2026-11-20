import { authenticate } from "../shopify.server";
import db from "../db.server";

// Sessions go now; store data is deleted when Shopify sends shop/redact (48 hours later).
export const action = async ({ request }) => {
  const { shop, session } = await authenticate.webhook(request);
  if (session) await db.session.deleteMany({ where: { shop } });
  return new Response();
};
