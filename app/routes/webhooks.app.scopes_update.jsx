import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { payload, session } = await authenticate.webhook(request);
  if (session) {
    await db.session.update({ where: { id: session.id }, data: { scope: payload.current.toString() } });
  }
  return new Response();
};
