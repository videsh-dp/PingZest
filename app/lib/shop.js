/**
 * Turn whatever a merchant types into a *.myshopify.com domain:
 * "Kurta-House", "kurta-house.myshopify.com", "https://admin.shopify.com/store/kurta-house/orders".
 * Returns "" when nothing usable was typed.
 */
export function normalizeShopInput(raw) {
  const s = String(raw || "").trim().toLowerCase();
  const handle = s
    .replace(/^https?:\/\//, "")
    .replace(/^admin\.shopify\.com\/store\//, "")
    .replace(/\.myshopify\.com.*$/, "")
    .replace(/[/?#].*$/, "");
  return /^[a-z0-9][a-z0-9-]{0,60}$/.test(handle) ? `${handle}.myshopify.com` : "";
}

/** "Priya S." from a Shopify session (online tokens carry the staff member). */
export function staffName(session) {
  const first = session?.onlineAccessInfo?.associated_user?.first_name || session?.firstName || "";
  const last = session?.onlineAccessInfo?.associated_user?.last_name || session?.lastName || "";
  return [first, last ? `${last[0]}.` : ""].filter(Boolean).join(" ").trim();
}
