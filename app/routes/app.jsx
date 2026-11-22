import { useEffect } from "react";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { staffName } from "../lib/shop.js";
import { getSettings } from "../models/settings.server";
import { syncPlan } from "../models/billing.server";
import { processDueCod } from "../models/cod-loop.server";
import { HOME, NAV_ITEMS } from "../lib/nav.js";
import { adminLocale, dictionaryFor } from "../i18n/server.js";
import { I18nProvider, useT } from "../i18n/react.jsx";
import { dirOf } from "../i18n/core.js";
import { getFlags, identifyShop } from "../posthog.server";
import { FlagsProvider } from "../components/flags.jsx";
import { reportError } from "../components/PostHogScript";
import styles from "../styles/app.css?url";

export const links = () => [{ rel: "stylesheet", href: styles }];

/** Work that must not hold up the page: it runs after the response is on its way. */
function inBackground(label, fn) {
  setTimeout(() => {
    Promise.resolve().then(fn).catch((e) => console.error(`${label} failed`, e?.message));
  }, 0);
}

export const loader = async ({ request }) => {
  const { session, billing, admin } = await authenticate.admin(request);
  // The page renders from the stored settings. The plan is kept current by the subscription webhook,
  // the Plan page (which checks Shopify before showing prices) and this background check (at most
  // every 10 minutes); the Pro autopilot also runs on COD webhooks and the /cron/cod endpoint.
  const settings = await getSettings(session.shop);
  inBackground("plan check", () => syncPlan(session.shop, billing, admin));
  inBackground("COD autopilot", () => processDueCod(session.shop, admin, { limit: 20 }));
  const locale = adminLocale({ request, session, settings });
  const profile = { plan: settings.plan || "free", app_locale: locale, country_code: settings.countryCode };
  identifyShop(session.shop, profile);
  const flags = await getFlags(session.shop, { personProperties: { shop: session.shop, ...profile } });
  return { apiKey: process.env.SHOPIFY_API_KEY || "", shop: session.shop, staff: staffName(session), locale, dict: dictionaryFor(locale), flags, plan: profile.plan };
};

// The layout's data (language, flags, plan) only changes when a form is saved (e.g. the app language
// in Settings), so moving between pages doesn't run it again.
export const shouldRevalidate = ({ formMethod, defaultShouldRevalidate }) => (formMethod && formMethod !== "GET" ? defaultShouldRevalidate : false);

export default function App() {
  const { apiKey, locale, dict, flags, shop, plan } = useLoaderData();
  // Browser analytics and errors are grouped under the shop (no staff or customer details).
  useEffect(() => {
    if (typeof window !== "undefined" && window.posthog?.identify) window.posthog.identify(shop, { shop, plan });
  }, [shop, plan]);
  // Page speed as Shopify measures it for Built for Shopify (LCP, CLS, INP): numbers only.
  useEffect(() => {
    const vitals = typeof window !== "undefined" ? window.shopify?.webVitals : null;
    if (!vitals?.onReport) return undefined;
    const off = vitals.onReport((report) => {
      const metrics = Object.fromEntries((report?.metrics || []).map((m) => [m.name, Math.round(Number(m.value) * 1000) / 1000]));
      window.posthog?.capture?.("web_vitals", { ...metrics, country: report?.country || null });
    });
    return typeof off === "function" ? off : undefined;
  }, []);
  return (
    <AppProvider embedded apiKey={apiKey}>
      <I18nProvider locale={locale} dict={dict}>
        <FlagsProvider flags={flags}>
          <div lang={locale} dir={dirOf(locale)} className="wa-app">
            <Nav />
            <main className="wa-app__main">
              <Outlet />
            </main>
          </div>
        </FlagsProvider>
      </I18nProvider>
    </AppProvider>
  );
}

/** Shopify's admin menu: the app's only navigation (app/lib/nav.js). */
function Nav() {
  const tr = useT();
  return (
    <NavMenu>
      <Link to={HOME.to} rel="home">{tr(HOME.label)}</Link>
      {NAV_ITEMS.map((i) => (
        <Link key={i.to} to={i.to}>{tr(i.label)}</Link>
      ))}
    </NavMenu>
  );
}

// Shopify needs these to handle auth redirects and errors inside the admin.
export function ErrorBoundary() {
  const error = useRouteError();
  useEffect(() => { if (!(error instanceof Response) && !error?.status) reportError(error, { source: "error-boundary" }); }, [error]);
  return boundary.error(error);
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
