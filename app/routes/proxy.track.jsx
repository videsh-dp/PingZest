import { authenticate } from "../shopify.server";
import { recordEvents } from "../models/widgets.server";

/**
 * App proxy endpoint: storefront widgets POST here via https://{shop}/apps/pingzest/track.
 * Shopify signs the request, so we know which shop it came from.
 * Body: { pageType, device, events: [{ widget, event }] }. Only daily counters are stored.
 */
export const action = async ({ request }) => {
  try {
    const { session } = await authenticate.public.appProxy(request);
    const shop = session?.shop;
    if (!shop) return new Response(null, { status: 204 });
    let body = {};
    try { body = JSON.parse(await request.text()); } catch { /* empty beacon */ }
    await recordEvents(shop, body);
  } catch (e) {
    console.error("track failed", e?.message);
  }
  return new Response(null, { status: 204 });
};

export const loader = () => new Response(null, { status: 204 });
