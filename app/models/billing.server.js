/**
 * Shopify Billing for the Pro plan. Prices live in app/lib/plans.js.
 * Charges are test charges until BILLING_TEST=false (development stores can only use test charges).
 */
import prisma from "../db.server";
import { BILLING_PLANS, planFromSubscription, planOf } from "../lib/plans.js";
import { getSettings } from "./settings.server";
import { resyncWidgets } from "./widgets.server";
import { capture } from "../posthog.server";

const RECHECK_MS = 10 * 60 * 1000;

export const isTestBilling = () => process.env.BILLING_TEST !== "false";

/** Where Shopify sends the merchant after approving: the Plan page inside their admin. */
export function billingReturnUrl(shop) {
  const handle = process.env.SHOPIFY_APP_HANDLE || "pingzest";
  const store = String(shop).replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${store}/apps/${handle}/app/settings/plan?upgraded=1`;
}

async function setPlan(shop, { plan, subscriptionId = null, subscriptionName = null, trialEndsAt = null }, admin, source) {
  const before = await getSettings(shop);
  const settings = await prisma.shopSettings.update({
    where: { shop },
    data: { plan, subscriptionId, subscriptionName, trialEndsAt, planCheckedAt: new Date() },
  });
  if (planOf(before) !== plan) {
    capture("plan_changed", shop, { from: planOf(before), to: plan, subscription: subscriptionName, source });
    if (admin) await resyncWidgets(shop, admin).catch((e) => console.error("widget resync failed", e?.message));
  }
  return settings;
}

function trialEnd(sub) {
  if (!sub?.trialDays || !sub?.createdAt) return null;
  const end = new Date(new Date(sub.createdAt).getTime() + sub.trialDays * 86400000);
  return end > new Date() ? end : null;
}

/**
 * Make sure ShopSettings.plan matches Shopify (at most every 10 minutes, or when forced,
 * e.g. right after the merchant approves a charge). Webhooks keep it current in between.
 */
export async function syncPlan(shop, billing, admin, { force = false } = {}) {
  const settings = await getSettings(shop);
  if (!force && settings.planCheckedAt && Date.now() - new Date(settings.planCheckedAt).getTime() < RECHECK_MS) return settings;
  try {
    const { appSubscriptions = [] } = await billing.check({ plans: Object.keys(BILLING_PLANS), isTest: isTestBilling() });
    const sub = appSubscriptions.find((s) => BILLING_PLANS[s.name]);
    const plan = sub ? planFromSubscription({ ...sub, status: sub.status || "ACTIVE" }) : "free";
    return await setPlan(shop, { plan, subscriptionId: sub?.id || null, subscriptionName: sub?.name || null, trialEndsAt: trialEnd(sub) }, admin, "check");
  } catch (e) {
    console.error("billing check failed", e?.message);
    return settings; // keep the last known plan
  }
}

/** app_subscriptions/update webhook. */
export async function applySubscriptionWebhook(shop, payload, admin) {
  const sub = payload?.app_subscription || {};
  const known = Boolean(BILLING_PLANS[sub.name]);
  if (!known) return getSettings(shop);
  const plan = planFromSubscription(sub);
  const current = await getSettings(shop);
  // A different subscription being cancelled (e.g. after switching monthly → yearly) must not downgrade.
  if (plan === "free" && current.subscriptionId && sub.admin_graphql_api_id && current.subscriptionId !== sub.admin_graphql_api_id) return current;
  return setPlan(
    shop,
    { plan, subscriptionId: plan === "free" ? null : sub.admin_graphql_api_id || null, subscriptionName: plan === "free" ? null : sub.name },
    admin,
    `webhook:${String(sub.status || "").toLowerCase()}`,
  );
}

/** Starts Shopify's approval page for a plan (throws a redirect, like Shopify's billing.request). */
export async function requestPlan(billing, shop, name) {
  if (!BILLING_PLANS[name]) throw new Error("Unknown plan");
  capture("plan_upgrade_started", shop, { subscription: name });
  return billing.request({ plan: name, isTest: isTestBilling(), returnUrl: billingReturnUrl(shop) });
}

export async function cancelPlan(billing, shop, admin) {
  const settings = await getSettings(shop);
  if (!settings.subscriptionId) return { error: "No active subscription." };
  await billing.cancel({ subscriptionId: settings.subscriptionId, isTest: isTestBilling(), prorate: true });
  await setPlan(shop, { plan: "free" }, admin, "cancel");
  return { ok: true };
}
