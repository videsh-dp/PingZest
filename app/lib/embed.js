/**
 * Is the PingZest app embed on in the store's live theme? App Bridge's shopify.app.extensions() reports it
 * in the browser (Home and Widgets send it to the server); merchants can also tick it themselves.
 * Counts as on if the latest check said active (within the last 7 days), or the merchant said so.
 */
const FRESH_MS = 7 * 24 * 3600e3;

export function embedOn(s, now = Date.now()) {
  if (s?.embedManual) return true;
  // A check that finds it off clears embedActiveAt.
  if (!s?.embedActiveAt) return false;
  return now - new Date(s.embedActiveAt).getTime() < FRESH_MS;
}

/** The app embed's activation in the list App Bridge returns ("app-embed" is extensions/pingzest-widgets/blocks/app-embed.liquid). */
export function embedActivation(extensions) {
  if (!Array.isArray(extensions)) return null;
  return extensions.filter((e) => e?.type === "theme_app_extension").flatMap((e) => e.activations || []).find((b) => b?.handle === "app-embed") || null;
}
