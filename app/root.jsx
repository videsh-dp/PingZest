import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData, useLocation } from "react-router";
import { requestLog } from "./middleware/request-log.server";
import { browserConfig } from "./posthog.server";
import { PostHogScript } from "./components/PostHogScript";

// Every request (pages, data, webhooks, storefront calls) is logged to PostHog.
export const middleware = [requestLog];

export const loader = () => ({ posthog: browserConfig() });

export default function App() {
  const data = useLoaderData();
  const { pathname } = useLocation();
  // No analytics on the customer-facing confirm page.
  const ph = pathname.startsWith("/c/") ? null : data?.posthog;
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <Meta />
        <Links />
        {ph && <PostHogScript config={ph} />}
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
