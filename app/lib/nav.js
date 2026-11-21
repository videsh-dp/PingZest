/**
 * The app's pages, grouped by what the merchant is doing. Drives Shopify's admin menu (NavMenu),
 * the app's own left sidebar and the category label above each page title.
 * Labels are English keys translated with tr(); N_ marks them for the extractor.
 * `badge` names a count from the app loader's navCounts (work waiting on that page).
 */
const N_ = (s) => s;

export const NAV_SECTIONS = [
  {
    title: N_("Overview"),
    items: [
      { to: "/app", label: N_("Home"), icon: "⌂", end: true },
      { to: "/app/analytics", label: N_("Analytics"), icon: "📈" },
    ],
  },
  {
    title: N_("Orders"),
    items: [
      { to: "/app/cod", label: N_("COD confirmation"), icon: "✓", badge: "cod" },
      { to: "/app/carts", label: N_("Abandoned checkouts"), icon: "🛒", badge: "carts" },
      { to: "/app/updates", label: N_("Order updates"), icon: "📦", badge: "updates" },
    ],
  },
  {
    title: N_("Storefront"),
    items: [
      { to: "/app/widgets", label: N_("Widgets"), icon: "💬" },
      { to: "/app/discounts", label: N_("Discounts"), icon: "％" },
    ],
  },
  {
    title: N_("Messages"),
    items: [{ to: "/app/templates", label: N_("Message templates"), icon: "✉" }],
  },
  {
    title: N_("Account"),
    items: [
      { to: "/app/settings", label: N_("Settings"), icon: "⚙" },
      { to: "/app/plan", label: N_("Plan"), icon: "★" },
    ],
  },
];

export const NAV_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);

/** The section a path belongs to ("/app/cod?x" → Orders), for the label above the page title. */
export function sectionFor(pathname) {
  const path = String(pathname || "").replace(/\/$/, "") || "/app";
  for (const s of NAV_SECTIONS) {
    for (const i of s.items) if (i.end ? path === i.to : path === i.to || path.startsWith(`${i.to}/`)) return { section: s, item: i };
  }
  return null;
}
