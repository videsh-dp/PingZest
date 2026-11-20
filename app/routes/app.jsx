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
import styles from "../styles/app.css?url";

export const links = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  const locale = adminLocale({ request, session, settings });
  return { apiKey: process.env.SHOPIFY_API_KEY || "", shop: session.shop, staff: staffName(session), locale, dict: dictionaryFor(locale) };
};

export default function App() {
  const { apiKey, locale, dict } = useLoaderData();
  return (
    <AppProvider embedded apiKey={apiKey}>
      <I18nProvider locale={locale} dict={dict}>
        <div lang={locale} dir={dirOf(locale)}>
          <Nav />
          <Outlet />
        </div>
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
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
