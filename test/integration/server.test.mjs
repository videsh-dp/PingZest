/**
 * Integration tests: the production build, a real MongoDB, and the app called the way Shopify
 * calls it (HMAC-signed webhooks, public pages). A fake PostHog server checks what gets logged.
 * Runs in CI (.github/workflows/ci.yml). Locally: build, start MongoDB, set DATABASE_URL, then
 *   npm run test:integration
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { openSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const PORT = 3000;
const PH_PORT = 4010;
const BASE = `http://localhost:${PORT}`;
const SECRET = process.env.SHOPIFY_API_SECRET || "ci-api-secret";
const SHOP = "ci-store.myshopify.com";
const PHONE = "919812345678"; // must never appear in PostHog

const prisma = new PrismaClient();
const events = [];
let server;
let posthog;

/* ---------- helpers ---------- */

async function waitFor(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not start: ${url}`);
}

async function webhook(path, topic, payload, { secret = SECRET, id = randomUUID() } = {}) {
  const body = JSON.stringify(payload);
  const hmac = createHmac("sha256", secret).update(body, "utf8").digest("base64");
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Topic": topic,
      "X-Shopify-Shop-Domain": SHOP,
      "X-Shopify-Hmac-Sha256": hmac,
      "X-Shopify-Webhook-Id": id,
      "X-Shopify-Event-Id": randomUUID(),
      "X-Shopify-Triggered-At": new Date().toISOString(),
      "X-Shopify-API-Version": "2025-10",
    },
    body,
  });
}

let nextId = 5001;
function codOrder(overrides = {}) {
  const id = nextId++;
  return {
    id,
    admin_graphql_api_id: `gid://shopify/Order/${id}`,
    name: `#${id}`,
    total_price: "1299.00",
    currency: "INR",
    payment_gateway_names: ["Cash on Delivery (COD)"],
    phone: `+${PHONE}`,
    customer: { first_name: "Priya", phone: `+${PHONE}` },
    shipping_address: { first_name: "Priya", last_name: "Shah", address1: "Flat 402, Sunrise Apartments, MG Road", address2: "Near City Mall", city: "Pune", zip: "411001", country_code: "IN", phone: `+${PHONE}` },
    line_items: [{ title: "Blue Cotton Kurta", quantity: 1, price: "1299.00" }],
    ...overrides,
  };
}

const flushPosthog = () => new Promise((r) => setTimeout(r, 4000)); // client flushes every 3 s

/* ---------- setup ---------- */

before(async () => {
  // Fake PostHog: records /batch/ events, answers /flags/ with one flag.
  posthog = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url.startsWith("/batch")) {
        try { events.push(...JSON.parse(raw).batch); } catch { /* ignore */ }
        res.end("{}");
      } else if (req.url.startsWith("/flags")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ flags: { "template-performance": { enabled: false } } }));
      } else res.end("{}");
    });
  }).listen(PH_PORT);

  for (const m of ["order", "checkout", "messageLog", "complianceRequest", "shopSettings", "messageTemplate", "session"]) {
    await prisma[m].deleteMany({ where: { shop: SHOP } });
  }

  const log = openSync("/tmp/pingzest-server.log", "w");
  server = spawn("npx", ["react-router-serve", "./build/server/index.js"], {
    env: { ...process.env, PORT: String(PORT), POSTHOG_API_KEY: "phc_ci", POSTHOG_HOST: `http://localhost:${PH_PORT}`, POSTHOG_STOREFRONT_SAMPLE: "1" },
    stdio: ["ignore", log, log],
  });
  await waitFor(`${BASE}/`);
});

after(async () => {
  server?.kill("SIGTERM");
  posthog?.close();
  await prisma.$disconnect();
});

/* ---------- public pages ---------- */

test("landing and login pages render, with the PostHog snippet", async () => {
  const home = await fetch(`${BASE}/`);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /PingZest/);
  assert.match(html, /posthog\.init\("phc_ci"/);

  const login = await fetch(`${BASE}/auth/login`);
  assert.equal(login.status, 200);
  assert.match(await login.text(), /myshopify\.com/);

  const es = await fetch(`${BASE}/`, { headers: { "accept-language": "es-ES,es;q=0.9" } });
  assert.match(await es.text(), /lang="es"/);
});

/* ---------- webhooks ---------- */

test("health check answers when the app and MongoDB are up", async () => {
  const r = await fetch(`${BASE}/healthz`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test("webhooks with a bad signature are rejected", async () => {
  const r = await webhook("/webhooks/orders", "orders/create", codOrder(), { secret: "wrong" });
  assert.equal(r.status, 401);
});

test("a new COD order is stored with a confirm token and a risk score (no address kept)", async () => {
  const p = codOrder();
  const r = await webhook("/webhooks/orders", "orders/create", p);
  assert.equal(r.status, 200, await r.text());
  const o = await prisma.order.findFirst({ where: { shop: SHOP, shopifyOrderId: String(p.id) } });
  assert.ok(o, "order saved");
  assert.equal(o.isCod, true);
  assert.equal(o.phone, PHONE);
  assert.ok(o.confirmToken, "confirm token");
  assert.equal(o.pincode, "411001");
  assert.deepEqual(o.addressFlags, []);
  assert.equal(o.riskLevel, "low");
  assert.equal(JSON.stringify(o).includes("Sunrise Apartments"), false, "street address must not be stored");
});

test("risk score uses the store's history: a number that cancelled before is flagged", async () => {
  await prisma.order.updateMany({ where: { shop: SHOP, phone: PHONE }, data: { codStatus: "cancelled" } });
  const p = codOrder({ shipping_address: { first_name: "Priya", address1: "test", zip: "000000", country_code: "IN", phone: `+${PHONE}` } });
  assert.equal((await webhook("/webhooks/orders", "orders/create", p)).status, 200);
  const o = await prisma.order.findFirst({ where: { shop: SHOP, shopifyOrderId: String(p.id) } });
  assert.equal(o.riskLevel, "high");
  const codes = o.riskReasons.map((x) => x.code);
  for (const c of ["phone_cancelled", "address_fake", "pin_invalid"]) assert.ok(codes.includes(c), `${c} in ${codes}`);
});

test("the same order delivered twice is stored once", async () => {
  const p = codOrder();
  await webhook("/webhooks/orders", "orders/create", p);
  await webhook("/webhooks/orders", "orders/create", p);
  assert.equal(await prisma.order.count({ where: { shop: SHOP, shopifyOrderId: String(p.id) } }), 1);
});

/* ---------- confirm page ---------- */

test("confirm page: shows the order, records Confirm, 404 for unknown links, no analytics", async () => {
  const p = codOrder();
  await webhook("/webhooks/orders", "orders/create", p);
  const o = await prisma.order.findFirst({ where: { shop: SHOP, shopifyOrderId: String(p.id) } });

  const page = await fetch(`${BASE}/c/${o.confirmToken}?l=hi`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, new RegExp(o.orderName));
  assert.match(html, /lang="hi"/);
  assert.equal(/posthog\.init/.test(html), false, "no PostHog on the customer page");

  const post = await fetch(`${BASE}/c/${o.confirmToken}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ choice: "confirmed" }),
    redirect: "manual",
  });
  assert.ok(post.status < 500, `confirm returned ${post.status}`);
  const after = await prisma.order.findUnique({ where: { id: o.id } });
  assert.equal(after.codStatus, "confirmed");
  assert.equal(after.codRespondedBy, "customer");

  assert.equal((await fetch(`${BASE}/c/not-a-real-token`)).status, 404);
});

/* ---------- billing ---------- */

test("plan changes from Shopify: subscribe → Pro, a different subscription cancelled → still Pro, cancelled → Free", async () => {
  const sub = { admin_graphql_api_id: "gid://shopify/AppSubscription/1", name: "PingZest Pro Monthly", status: "ACTIVE" };
  assert.equal((await webhook("/webhooks/app/subscriptions_update", "app_subscriptions/update", { app_subscription: sub })).status, 200);
  assert.equal((await prisma.shopSettings.findUnique({ where: { shop: SHOP } })).plan, "pro");

  await webhook("/webhooks/app/subscriptions_update", "app_subscriptions/update", { app_subscription: { ...sub, admin_graphql_api_id: "gid://shopify/AppSubscription/0", status: "CANCELLED" } });
  assert.equal((await prisma.shopSettings.findUnique({ where: { shop: SHOP } })).plan, "pro");

  await webhook("/webhooks/app/subscriptions_update", "app_subscriptions/update", { app_subscription: { ...sub, status: "FROZEN" } });
  const s = await prisma.shopSettings.findUnique({ where: { shop: SHOP } });
  assert.equal(s.plan, "free");
  assert.equal(s.subscriptionId, null);
});

/* ---------- COD → prepaid ---------- */

test("orders/paid: counts as switched to prepaid only if the customer used the payment link", async () => {
  const a = codOrder(), b = codOrder();
  await webhook("/webhooks/orders", "orders/create", a);
  await webhook("/webhooks/orders", "orders/create", b);
  await prisma.order.updateMany({ where: { shop: SHOP, shopifyOrderId: String(a.id) }, data: { prepaidOfferedAt: new Date() } });

  assert.equal((await webhook("/webhooks/orders-paid", "orders/paid", { ...a, financial_status: "paid" })).status, 200);
  assert.equal((await webhook("/webhooks/orders-paid", "orders/paid", { ...b, financial_status: "paid" })).status, 200);
  const oa = await prisma.order.findFirst({ where: { shop: SHOP, shopifyOrderId: String(a.id) } });
  const ob = await prisma.order.findFirst({ where: { shop: SHOP, shopifyOrderId: String(b.id) } });
  assert.equal(oa.convertedToPrepaid, true);
  assert.equal(oa.codStatus, "confirmed");
  assert.ok(oa.paidAt);
  assert.equal(ob.convertedToPrepaid, false);
  assert.ok(ob.paidAt);
});

/* ---------- privacy ---------- */

test("privacy: data request stored as pending with the customer's data, once; redact deletes and clears it", async () => {
  const payload = { shop_domain: SHOP, customer: { id: 77, phone: `+${PHONE}` }, orders_requested: [], data_request: { id: 9001 } };
  const id = randomUUID();
  assert.equal((await webhook("/webhooks/compliance", "customers/data_request", payload, { id })).status, 200);
  assert.equal((await webhook("/webhooks/compliance", "customers/data_request", payload, { id })).status, 200); // Shopify retry
  const reqs = await prisma.complianceRequest.findMany({ where: { shop: SHOP, topic: "customers/data_request" } });
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].status, "pending");
  assert.equal(reqs[0].requestId, "9001");
  assert.ok(reqs[0].data.orders.length >= 3, `orders in export: ${reqs[0].data.orders.length}`);
  assert.equal(reqs[0].data.orders[0].id, undefined, "no internal ids in the export");

  const red = await webhook("/webhooks/compliance", "customers/redact", { shop_domain: SHOP, customer: { id: 77, phone: `+${PHONE}` }, orders_to_redact: [] });
  assert.equal(red.status, 200);
  assert.equal(await prisma.order.count({ where: { shop: SHOP, phone: PHONE } }), 0);
  const cleared = await prisma.complianceRequest.findUnique({ where: { id: reqs[0].id } });
  assert.equal(cleared.status, "redacted");
  assert.equal(cleared.data, null);
});

test("privacy: shop/redact deletes the shop's data and keeps a log row", async () => {
  await webhook("/webhooks/orders", "orders/create", codOrder());
  assert.equal((await webhook("/webhooks/compliance", "shop/redact", { shop_domain: SHOP })).status, 200);
  assert.equal(await prisma.order.count({ where: { shop: SHOP } }), 0);
  assert.equal(await prisma.complianceRequest.count({ where: { shop: SHOP, topic: "shop/redact" } }), 1);
});

/* ---------- PostHog ---------- */

test("PostHog: every request is logged with status and timing, and customer data never leaves", async () => {
  await fetch(`${BASE}/c/still-not-real`);
  await flushPosthog();
  const reqs = events.filter((e) => e.event === "api_request");
  assert.ok(reqs.length >= 10, `api_request events: ${reqs.length}`);
  const hook = reqs.find((e) => e.properties.kind === "webhook" && e.properties.status === 200);
  assert.ok(hook, "webhook request logged");
  assert.equal(hook.distinct_id, SHOP);
  assert.ok(hook.properties.webhook_topic);
  assert.ok(typeof hook.properties.duration_ms === "number");
  assert.ok(reqs.some((e) => e.properties.status === 401), "rejected webhook logged");
  const confirm = reqs.find((e) => e.properties.kind === "confirm_page");
  assert.ok(confirm, "confirm page logged");
  assert.match(confirm.properties.path, /^\/c\/:token$/, "confirm token hidden in the path");
  assert.ok(events.some((e) => e.event === "cod_risk_scored"));
  assert.ok(events.some((e) => e.event === "privacy_data_request"));
  assert.ok(events.some((e) => e.event === "plan_changed"));

  const all = JSON.stringify(events);
  assert.equal(all.includes(PHONE), false, "phone number sent to PostHog");
  assert.equal(all.includes("Sunrise Apartments"), false, "address sent to PostHog");
});
