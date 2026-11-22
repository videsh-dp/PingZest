import { redirect, useLoaderData } from "react-router";
import { Landing } from "../components/Landing";
import styles from "../styles/landing.css?url";
import { browserLocale, dictionaryFor } from "../i18n/server.js";

const showLoginForm = () => process.env.SHOW_LOGIN_FORM === "1" || process.env.NODE_ENV === "development";

export const links = () => [{ rel: "stylesheet", href: styles }];
export const meta = () => [
  { title: "PingZest · WhatsApp tools for Shopify" },
  { name: "description", content: "WhatsApp chat button, COD confirmation, order updates and discount banner for Shopify stores." },
];

// Opened from Shopify admin (has ?shop=) → straight into the embedded app.
// Opened directly → landing page that sends merchants to the Shopify App Store (no store-address form
// in production; self-hosted setups can turn it back on with SHOW_LOGIN_FORM=1).
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) throw redirect(`/app?${url.searchParams.toString()}`);
  const locale = browserLocale(request);
  return { showLogin: showLoginForm(), installUrl: process.env.SHOPIFY_APP_STORE_URL || "https://apps.shopify.com/search?q=pingzest", locale, dict: dictionaryFor(locale) };
};

export default function Index() {
  const { showLogin, installUrl, locale, dict } = useLoaderData();
  return <Landing showLogin={showLogin} installUrl={installUrl} locale={locale} dict={dict} />;
}
