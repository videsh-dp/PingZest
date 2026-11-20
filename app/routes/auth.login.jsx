import { useActionData, useLoaderData } from "react-router";
import { login } from "../shopify.server";
import { Landing } from "../components/Landing";
import { normalizeShopInput } from "../lib/shop.js";
import styles from "../styles/landing.css?url";

export const links = () => [{ rel: "stylesheet", href: styles }];

// Shopify's login: validates the store address and redirects to Shopify to sign in / install.
export const loader = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));
  return { errors, shop: new URL(request.url).searchParams.get("shop") || "" };
};

export const action = async ({ request }) => {
  // Accept "your-store", "your-store.myshopify.com" or a full admin URL.
  const form = await request.formData();
  const fixed = new FormData();
  fixed.set("shop", normalizeShopInput(form.get("shop")));
  const errors = loginErrorMessage(await login(new Request(request.url, { method: "POST", body: fixed, headers: request.headers })));
  return { errors };
};

function loginErrorMessage(result) {
  if (result?.shop === "MISSING_SHOP") return { shop: "Enter your store address." };
  if (result?.shop === "INVALID_SHOP") return { shop: "That doesn't look like a Shopify store address. Try your-store.myshopify.com." };
  return {};
}

export default function Auth() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const errors = (actionData || loaderData).errors;
  return <Landing errors={errors} defaultShop={loaderData.shop.replace(".myshopify.com", "")} />;
}
