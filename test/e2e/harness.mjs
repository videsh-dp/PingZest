/**
 * Shared setup for the end-to-end tests: a fake Shopify over HTTPS, a clean shop in MongoDB with the
 * offline session Shopify creates at install, and the production server. Plus helpers that call the app
 * the way Shopify admin (session tokens) and Shopify itself (signed webhooks) do.
 */
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { openSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { startFakeShopify } from "./fake-shopify.mjs";

export const SHOP = "e2e-store.myshopify.com";
export const API_KEY = process.env.SHOPIFY_API_KEY || "ci-api-key";
export const SECRET = process.env.SHOPIFY_API_SECRET || "ci-api-secret";
export const SCOPES = process.env.SCOPES || "";
export const CERT = process.env.E2E_CERT || "/tmp/e2e/cert.pem";
export const KEY = process.env.E2E_KEY || "/tmp/e2e/key.pem";
export const HOST_PARAM = Buffer.from(`admin.shopify.com/store/${SHOP.replace(".myshopify.com", "")}`).toString("base64url");
// A real browser's user agent: Shopify's library answers 410 to requests that look like bots (Node's fetch does).
export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

export const prisma = new PrismaClient();

const b64url = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

/** A session token like App Bridge gives the embedded app (HS256, signed with the app secret). */
export function sessionToken({ sub = "42", ttl = 60 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url({ iss: `https://${SHOP}/admin`, dest: `https://${SHOP}`, aud: API_KEY, sub, exp: now + ttl, nbf: now - 5, iat: now - 5, jti: randomUUID(), sid: "e2e-sid" });
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

let nextOrder = 9001 + Math.floor(Math.random() * 1000) * 100;
export function codOrder(overrides = {}) {
  const id = nextOrder++;
  return {
    id, admin_graphql_api_id: `gid://shopify/Order/${id}`, name: `#${id}`, total_price: "1299.00", subtotal_price: "1299.00", currency: "INR",
    payment_gateway_names: ["Cash on Delivery (COD)"], phone: "+919812345678", email: "priya@example.com",
    customer: { first_name: "Priya", phone: "+919812345678", orders_count: 1 },
    shipping_address: { first_name: "Priya", last_name: "Shah", address1: "Flat 402, Sunrise Apartments, MG Road", address2: "Near City Mall", city: "Pune", zip: "411001", country_code: "IN", phone: "+919812345678" },
    line_items: [{ title: "Blue Cotton Kurta", quantity: 1, price: "1299.00" }],
    order_status_url: `https://${SHOP}/orders/status/${id}`,
    ...overrides,
  };
}

async function waitFor(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not start: ${url}`);
}

/** Starts everything; returns helpers bound to this server. */
export async function startApp({ port, log = `/tmp/pingzest-e2e-${port}.log` }) {
  const BASE = `http://localhost:${port}`;
  const shopify = await startFakeShopify({ port: Number(process.env.FAKE_SHOPIFY_PORT || 8443), cert: CERT, key: KEY, scopes: SCOPES });

  for (const m of ["order", "checkout", "messageLog", "complianceRequest", "messageTemplate", "discount", "widgetConfig", "widgetEvent"]) {
    await prisma[m].deleteMany({ where: { shop: SHOP } }).catch(() => {});
  }
  await prisma.shopSettings.deleteMany({ where: { shop: SHOP } });
  await prisma.session.deleteMany({ where: { shop: SHOP } });
  // The offline session Shopify creates at install (used by webhooks and the confirm page).
  await prisma.session.create({ data: { id: `offline_${SHOP}`, shop: SHOP, state: "installed", isOnline: false, scope: SCOPES, accessToken: "shpat_fake_offline" } });

  // E2E_SERVER=dev runs the Vite dev server (what `shopify app dev` runs on your laptop) instead of the build.
  const dev = process.env.E2E_SERVER === "dev";
  const cmd = dev ? ["react-router", "dev", "--port", String(port), "--strictPort"] : ["react-router-serve", "./build/server/index.js"];
  const server = spawn("npx", cmd, {
    env: { ...process.env, PORT: String(port), SHOPIFY_APP_URL: BASE, NODE_EXTRA_CA_CERTS: CERT, POSTHOG_API_KEY: "", BILLING_TEST: "true", ...(dev ? { NODE_ENV: "development" } : {}) },
    stdio: ["ignore", openSync(log, "w"), openSync(log, "a")],
  });
  await waitFor(`${BASE}/healthz`, dev ? 120000 : 60000);

  function adminUrl(path, extra = {}) {
    const u = new URL(path, BASE);
    const params = { embedded: "1", shop: SHOP, host: HOST_PARAM, locale: "en", id_token: sessionToken(), ...extra };
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }

  /** GET an admin page as Shopify admin loads it in the iframe. */
  async function page(path, extra) {
    const res = await fetch(adminUrl(path, extra), { redirect: "manual", headers: { "User-Agent": UA } });
    return { status: res.status, html: await res.text(), headers: res.headers };
  }

  /** POST a form to an admin page (what a <Form method="post"> does), with the session token. */
  async function act(path, fields) {
    const res = await fetch(adminUrl(path), {
      method: "POST",
      redirect: "manual",
      headers: { "User-Agent": UA, Authorization: `Bearer ${sessionToken()}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    });
    return { status: res.status, html: await res.text(), headers: res.headers };
  }

  async function webhook(path, topic, payload) {
    const body = JSON.stringify(payload);
    const hmac = createHmac("sha256", SECRET).update(body, "utf8").digest("base64");
    return fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "X-Shopify-Topic": topic, "X-Shopify-Shop-Domain": SHOP, "X-Shopify-Hmac-Sha256": hmac,
        "X-Shopify-Webhook-Id": randomUUID(), "X-Shopify-Event-Id": randomUUID(), "X-Shopify-Triggered-At": new Date().toISOString(), "X-Shopify-API-Version": "2026-10",
      },
      body,
    });
  }

  async function stop() {
    server.kill("SIGTERM");
    shopify.close();
    await prisma.$disconnect();
  }

  return { BASE, shopify, adminUrl, page, act, webhook, stop };
}
