import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { staffName } from "../lib/shop.js";
import { syncPlan } from "../models/billing.server";
import { navCounts } from "../models/orders.server";
import { NAV_SECTIONS, NAV_ITEMS } from "../lib/nav.js";
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
  const [flags, counts] = await Promise.all([
    getFlags(session.shop, { personProperties: { shop: session.shop, ...profile } }),
    navCounts(session.shop, { delayMin: settings.abandonDelayMin }).catch(() => ({})),
  ]);
  return { apiKey: process.env.SHOPIFY_API_KEY || "", shop: session.shop, staff: staffName(session), locale, dict: dictionaryFor(locale), flags, plan: profile.plan, counts };
};

export default function App() {
  const { apiKey, locale, dict, flags, shop, plan, counts } = useLoaderData();
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
            <Sidebar plan={plan} counts={counts || {}} />
            <main className="wa-shell__main">
              <Outlet />
            </main>
          </div>
        </FlagsProvider>
      </I18nProvider>
    </AppProvider>
  );
}

// app/lib/nav.js drives both menus: Shopify's admin menu (NavMenu) and the app's own left sidebar.
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
function Sidebar({ plan, counts }) {
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
                    <span className="wa-sidebar__label">{tr(i.label)}</span>
                    {i.badge && counts[i.badge] > 0 ? (
                      <span className="wa-sidebar__badge" aria-label={tr("{count} to send", { count: counts[i.badge] })}>{counts[i.badge] > 99 ? "99+" : counts[i.badge]}</span>
                    ) : null}
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
