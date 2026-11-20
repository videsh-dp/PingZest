import { redirect, useLoaderData } from "react-router";
import { Landing } from "../components/Landing";
import styles from "../styles/landing.css?url";
import { browserLocale, dictionaryFor } from "../i18n/server.js";

export const links = () => [{ rel: "stylesheet", href: styles }];
export const meta = () => [
  { title: "PingZest · WhatsApp tools for Shopify" },
  { name: "description", content: "WhatsApp chat button, COD confirmation, order updates and discount banner for Shopify stores." },
];

// Opened from Shopify admin (has ?shop=) → straight into the embedded app.
// Opened directly → landing page with "Log in with Shopify".
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) throw redirect(`/app?${url.searchParams.toString()}`);
  const locale = browserLocale(request);
  return { signedOut: url.searchParams.get("signed_out") === "1", locale, dict: dictionaryFor(locale) };
};

export default function Index() {
  const { signedOut, locale, dict } = useLoaderData();
  return <Landing signedOut={signedOut} locale={locale} dict={dict} />;
}
