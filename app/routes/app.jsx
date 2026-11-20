import { useEffect } from "react";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { staffName } from "../lib/shop.js";
import { getSettings } from "../models/settings.server";
import { adminLocale, dictionaryFor } from "../i18n/server.js";
import { I18nProvider, useT } from "../i18n/react.jsx";
import { dirOf } from "../i18n/core.js";
import { getFlags, identifyShop } from "../posthog.server";
import { FlagsProvider } from "../components/flags.jsx";
import { reportError } from "../components/PostHogScript";
import styles from "../styles/app.css?url";

export const links = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  const locale = adminLocale({ request, session, settings });
  const profile = { plan: settings.plan || "free", app_locale: locale, country_code: settings.countryCode };
  identifyShop(session.shop, profile);
  const flags = await getFlags(session.shop, { personProperties: { shop: session.shop, ...profile } });
  return { apiKey: process.env.SHOPIFY_API_KEY || "", shop: session.shop, staff: staffName(session), locale, dict: dictionaryFor(locale), flags, plan: profile.plan };
};

export default function App() {
  const { apiKey, locale, dict, flags, shop, plan } = useLoaderData();
  // Browser analytics and errors are grouped under the shop (no staff or customer details).
  useEffect(() => {
    if (typeof window !== "undefined" && window.posthog?.identify) window.posthog.identify(shop, { shop, plan });
  }, [shop, plan]);
  return (
    <AppProvider embedded apiKey={apiKey}>
      <I18nProvider locale={locale} dict={dict}>
        <FlagsProvider flags={flags}>
          <div lang={locale} dir={dirOf(locale)}>
            <Nav />
            <Outlet />
          </div>
        </FlagsProvider>
      </I18nProvider>
    </AppProvider>
  );
}

function Nav() {
  const tr = useT();
  return (
      <NavMenu>
        <Link to="/app" rel="home">{tr("Home")}</Link>
        <Link to="/app/widgets">{tr("Widgets")}</Link>
        <Link to="/app/discounts">{tr("Discounts")}</Link>
        <Link to="/app/analytics">{tr("Analytics")}</Link>
        <Link to="/app/cod">{tr("COD confirmation")}</Link>
        <Link to="/app/carts">{tr("Abandoned checkouts")}</Link>
        <Link to="/app/updates">{tr("Order updates")}</Link>
        <Link to="/app/templates">{tr("Message templates")}</Link>
        <Link to="/app/settings">{tr("Settings")}</Link>
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
