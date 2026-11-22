import { useActionData, useLoaderData } from "react-router";
import { login } from "../shopify.server";
import { Landing } from "../components/Landing";
import { normalizeShopInput } from "../lib/shop.js";
import styles from "../styles/landing.css?url";
import { N_ } from "../i18n/core.js";
import { browserLocale, dictionaryFor } from "../i18n/server.js";

export const links = () => [{ rel: "stylesheet", href: styles }];

// Shopify's login: validates the store address and redirects to Shopify to sign in / install.
export const loader = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));
  const locale = browserLocale(request);
  return { errors, shop: new URL(request.url).searchParams.get("shop") || "", locale, dict: dictionaryFor(locale) };
};

export const action = async ({ request }) => {
  // Accept "your-store", "your-store.myshopify.com" or a full admin URL.
  const form = await request.formData();
  const fixed = new FormData();
  fixed.set("shop", normalizeShopInput(form.get("shop")));
  // Don't reuse the browser's Content-Type / Content-Length: they describe the original body (its multipart
  // boundary and size), not `fixed`, and login() would fail to parse the form ("Error: Bad Request").
  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  const errors = loginErrorMessage(await login(new Request(request.url, { method: "POST", body: fixed, headers })));
  return { errors };
};

function loginErrorMessage(result) {
  if (result?.shop === "MISSING_SHOP") return { shop: N_("Enter your store address.") };
  if (result?.shop === "INVALID_SHOP") return { shop: N_("That doesn't look like a Shopify store address. Try your-store.myshopify.com.") };
  return {};
}

export default function Auth() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const errors = (actionData || loaderData).errors;
  return <Landing showLogin errors={errors} defaultShop={loaderData.shop.replace(".myshopify.com", "")} locale={loaderData.locale} dict={loaderData.dict} />;
}
