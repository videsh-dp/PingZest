import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { staffName } from "../lib/shop.js";
import { syncPlan } from "../models/billing.server";
import { adminLocale, dictionaryFor } from "../i18n/server.js";
import { I18nProvider, useT } from "../i18n/react.jsx";
import { dirOf } from "../i18n/core.js";
import { getFlags, identifyShop } from "../posthog.server";
import { FlagsProvider } from "../components/flags.jsx";
import { reportError } from "../components/PostHogScript";
import styles from "../styles/app.css?url";

export const links = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }) => {
  const { session, billing, admin } = await authenticate.admin(request);
  // Keeps the plan in step with Shopify billing (checked at most every 10 minutes; webhooks cover the rest).
  const settings = await syncPlan(session.shop, billing, admin);
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
          <div lang={locale} dir={dirOf(locale)} className="wa-shell">
            <Nav />
            <Sidebar plan={plan} />
            <main className="wa-shell__main">
              <Outlet />
            </main>
          </div>
        </FlagsProvider>
      </I18nProvider>
    </AppProvider>
  );
}

// One list drives both menus: Shopify's admin sidebar (NavMenu) and the app's own left sidebar.
// Labels are English keys translated with tr(); N_ marks them for the extractor.
const N_ = (s) => s;
export const NAV_SECTIONS = [
  { title: null, items: [{ to: "/app", label: N_("Home"), icon: "⌂", end: true }] },
  {
    title: N_("Orders"),
    items: [
      { to: "/app/cod", label: N_("COD confirmation"), icon: "✓" },
      { to: "/app/carts", label: N_("Abandoned checkouts"), icon: "🛒" },
      { to: "/app/updates", label: N_("Order updates"), icon: "📦" },
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
    items: [
      { to: "/app/templates", label: N_("Message templates"), icon: "✉" },
      { to: "/app/analytics", label: N_("Analytics"), icon: "📈" },
    ],
  },
  {
    title: N_("Account"),
    items: [
      { to: "/app/settings", label: N_("Settings"), icon: "⚙" },
      { to: "/app/plan", label: N_("Plan"), icon: "★" },
    ],
  },
];
const NAV_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);

function Nav() {
  const tr = useT();
  return (
    <NavMenu>
      {NAV_ITEMS.map((i) => (
        <Link key={i.to} to={i.to} rel={i.end ? "home" : undefined}>{tr(i.label)}</Link>
      ))}
    </NavMenu>
  );
}

/** The app's own left sidebar: always there, so the app is easy to get around wherever it's opened. */
function Sidebar({ plan }) {
  const tr = useT();
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]); // close the mobile menu after navigating
  // Keep Shopify's embedded query params (shop, host, embedded) on every link.
  const keep = new URLSearchParams(search);
  ["id_token", "session", "hmac", "timestamp", "locale"].forEach((k) => keep.delete(k));
  const qs = keep.toString() ? `?${keep}` : "";
  return (
    <>
      <button type="button" className="wa-sidebar__toggle" aria-expanded={open} aria-controls="wa-sidebar" onClick={() => setOpen((v) => !v)}>
        <span aria-hidden="true">☰</span> {tr("Menu")}
      </button>
      <nav id="wa-sidebar" className={`wa-sidebar${open ? " is-open" : ""}`} aria-label={tr("PingZest navigation")}
        onClick={(e) => { if (e.target.closest("a")) setOpen(false); }}>
        <div className="wa-sidebar__brand">PingZest</div>
        {NAV_SECTIONS.map((section, si) => (
          <div className="wa-sidebar__section" key={si}>
            {section.title ? <div className="wa-sidebar__heading">{tr(section.title)}</div> : null}
            <ul>
              {section.items.map((i) => (
                <li key={i.to}>
                  <NavLink to={`${i.to}${qs}`} end={i.end} className={({ isActive }) => `wa-sidebar__link${isActive ? " is-active" : ""}`}>
                    <span className="wa-sidebar__icon" aria-hidden="true">{i.icon}</span>
                    <span>{tr(i.label)}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <Link to={`/app/plan${qs}`} className="wa-sidebar__plan">
          {plan === "pro" ? tr("Pro plan") : tr("Free plan · Upgrade")}
        </Link>
      </nav>
    </>
  );
}

// Shopify needs these to handle auth redirects and errors inside the admin.
export function ErrorBoundary() {
  const error = useRouteError();
  useEffect(() => { if (!(error instanceof Response) && !error?.status) reportError(error, { source: "error-boundary" }); }, [error]);
  return boundary.error(error);
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
