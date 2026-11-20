import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { staffName } from "../lib/shop.js";
import styles from "../styles/app.css?url";

export const links = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "", shop: session.shop, staff: staffName(session) };
};

export default function App() {
  const { apiKey } = useLoaderData();
  return (
    <AppProvider embedded apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Home</Link>
        <Link to="/app/widgets">Widgets</Link>
        <Link to="/app/discounts">Discounts</Link>
        <Link to="/app/analytics">Analytics</Link>
        <Link to="/app/cod">COD confirmation</Link>
        <Link to="/app/carts">Abandoned checkouts</Link>
        <Link to="/app/updates">Order updates</Link>
        <Link to="/app/templates">Message templates</Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs these to handle auth redirects and errors inside the admin.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
