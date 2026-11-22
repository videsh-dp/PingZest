/**
 * The app's pages, as listed in Shopify's admin menu (NavMenu / s-app-nav). This is the only navigation:
 * Shopify asks apps not to draw a second menu inside the page (Built for Shopify 4.1.4).
 *
 * Seven visible items at most (Shopify hides the rest behind "View more"), nouns, no icons or emoji.
 * The daily COD workflow comes first so it is always one click away:
 *   COD confirmation · Abandoned checkouts · Order updates · Templates · Widgets · Analytics · Settings
 * Pages that used to be their own items live under their parent, so the parent stays highlighted:
 *   Discounts → /app/widgets/discounts (they feed the discount banner), Plan → /app/settings/plan.
 * Home ("/app", rel="home") is the app name in the admin and isn't listed as an item.
 *
 * Labels are English keys translated with tr(); N_ marks them for the extractor.
 */
const N_ = (s) => s;

export const HOME = { to: "/app", label: N_("Home") };

export const NAV_ITEMS = [
  { to: "/app/cod", label: N_("COD confirmation") },
  { to: "/app/carts", label: N_("Abandoned checkouts") },
  { to: "/app/updates", label: N_("Order updates") },
  { to: "/app/templates", label: N_("Templates") },
  { to: "/app/widgets", label: N_("Widgets") },
  { to: "/app/analytics", label: N_("Analytics") },
  { to: "/app/settings", label: N_("Settings") },
];

export const MAX_NAV_ITEMS = 7;

/** The menu item a path belongs to ("/app/widgets/discounts" → Widgets), or null for Home. */
export function navItemFor(pathname) {
  const path = String(pathname || "").replace(/\/$/, "") || "/app";
  return NAV_ITEMS.find((i) => path === i.to || path.startsWith(`${i.to}/`)) || null;
}
