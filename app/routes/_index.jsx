import { redirect, useLoaderData } from "react-router";
import { Landing } from "../components/Landing";
import styles from "../styles/landing.css?url";

export const links = () => [{ rel: "stylesheet", href: styles }];
export const meta = () => [
  { title: "WA Assist · WhatsApp tools for Shopify" },
  { name: "description", content: "WhatsApp chat button, COD confirmation, order updates and discount banner for Shopify stores." },
];

// Opened from Shopify admin (has ?shop=) → straight into the embedded app.
// Opened directly → landing page with "Log in with Shopify".
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) throw redirect(`/app?${url.searchParams.toString()}`);
  return { signedOut: url.searchParams.get("signed_out") === "1" };
};

export default function Index() {
  const { signedOut } = useLoaderData();
  return <Landing signedOut={signedOut} />;
}
