/**
 * Plans, prices and what each plan unlocks. Pure module (used by server and UI).
 *
 * A shop's plan is ShopSettings.plan, kept in sync with its Shopify subscription
 * (app/models/billing.server.js). Change prices here; Shopify shows them on its approval page.
 * Built-in "Standard" templates (one per stage and language) never count against a limit.
 */
import { N_ } from "../i18n/core.js";

export const TRIAL_DAYS = 7;

/** Shopify subscription names → our plan. The names are what merchants see on their Shopify invoice. */
export const BILLING_PLANS = {
  "PingZest Pro Monthly": { plan: "pro", interval: "EVERY_30_DAYS", amount: 9.99, currency: "USD" },
  "PingZest Pro Yearly": { plan: "pro", interval: "ANNUAL", amount: 99, currency: "USD" },
};
export const PRO_MONTHLY = "PingZest Pro Monthly";
export const PRO_YEARLY = "PingZest Pro Yearly";

export const PLANS = {
  free: { name: "Free", customTemplates: 5, features: [] },
  pro: {
    name: "Pro",
    customTemplates: null, // null = unlimited
    features: ["unlimitedTemplates", "noBranding", "codRisk", "prepaidOffer", "addressCheck", "codAutomation", "rtoInsights"],
  },
};

/** What the Plan page lists, in order. */
export const FEATURE_LIST = [
  { key: "basics", free: true, label: N_("Chat button, discount banner, page buttons, COD queue, cart and order messages, analytics, 7 languages") },
  { key: "codLoop", free: true, label: N_("Close the COD loop: hold fulfillment until confirmed, reminders, expire, cancel and restock in Shopify with one click") },
  { key: "savings", free: true, label: N_("“Saved on returns”: what confirmations saved you, in money") },
  { key: "templates", free: N_("5 custom"), pro: N_("Unlimited"), label: N_("Message templates") },
  { key: "codRisk", label: N_("COD risk score: spot risky orders before you ship") },
  { key: "codAutomation", label: N_("COD autopilot: expire unanswered orders and cancel + restock them in Shopify automatically") },
  { key: "rtoInsights", label: N_("Returns insights: RTO by PIN code, first-time buyer, coupon and order hour, with CSV export") },
  { key: "prepaidOffer", label: N_("COD → prepaid: customers can pay online for a small discount") },
  { key: "addressCheck", label: N_("Address check: customers fix their address or add a landmark") },
  { key: "noBranding", label: N_("No “Powered by PingZest” on your chat widget") },
];

export function planOf(settings) {
  return PLANS[settings?.plan] ? settings.plan : "free";
}

export function hasFeature(plan, feature) {
  return (PLANS[plan] || PLANS.free).features.includes(feature);
}

/** { limit, used, remaining, canCreate } for templates the merchant created themselves. */
export function templateAllowance(plan, used) {
  const limit = (PLANS[plan] || PLANS.free).customTemplates;
  if (limit == null) return { limit: null, used, remaining: null, canCreate: true };
  const remaining = Math.max(0, limit - used);
  return { limit, used, remaining, canCreate: remaining > 0 };
}

/**
 * Our plan from a Shopify subscription status. FROZEN (payment failed) and anything that
 * isn't ACTIVE means Free; Shopify reactivates FROZEN subscriptions when the bill is paid.
 */
export function planFromSubscription(sub) {
  if (!sub || String(sub.status).toUpperCase() !== "ACTIVE") return "free";
  return BILLING_PLANS[sub.name]?.plan || "free";
}
