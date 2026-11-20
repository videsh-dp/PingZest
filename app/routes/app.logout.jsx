import { redirect } from "react-router";
import { authenticate, sessionStorage } from "../shopify.server";

/**
 * "Sign out of PingZest": removes this staff member's online session.
 * The store's offline token stays, so webhooks and confirm links keep working.
 * Opening the app again from Shopify admin signs them back in automatically.
 */
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  if (session?.isOnline) await sessionStorage.deleteSession(session.id);
  throw redirect("/?signed_out=1");
};

export const loader = () => redirect("/app");
