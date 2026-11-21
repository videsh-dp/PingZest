import "@shopify/shopify-app-react-router/adapters/node";
import { ApiVersion, AppDistribution, BillingInterval, shopifyApp } from "@shopify/shopify-app-react-router/server";
import { PingZestSessionStorage } from "./session-storage.server";
import prisma from "./db.server";
import { BILLING_PLANS, TRIAL_DAYS } from "./lib/plans.js";

// Use the newest version your installed @shopify/shopify-app-react-router offers.
const apiVersion =
  ApiVersion.October26 || ApiVersion.July26 || ApiVersion.April26 || ApiVersion.January26 || ApiVersion.October25;

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PingZestSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  // Shopify's Admin API no longer accepts non-expiring offline tokens; expiring ones refresh automatically.
  future: { expiringOfflineAccessTokens: true },
  // Online tokens identify the staff member who's signed in (name shown in the app).
  // Shopify still stores an offline token at install for webhooks and the public confirm page.
  useOnlineTokens: true,
  // Paid plans (prices in app/lib/plans.js). Charged through Shopify, on the merchant's Shopify bill.
  billing: Object.fromEntries(
    Object.entries(BILLING_PLANS).map(([name, p]) => [
      name,
      {
        trialDays: TRIAL_DAYS,
        lineItems: [{ amount: p.amount, currencyCode: p.currency, interval: p.interval === "ANNUAL" ? BillingInterval.Annual : BillingInterval.Every30Days }],
      },
    ]),
  ),
  ...(process.env.SHOP_CUSTOM_DOMAIN ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] } : {}),
});

export default shopify;
export { apiVersion };
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
