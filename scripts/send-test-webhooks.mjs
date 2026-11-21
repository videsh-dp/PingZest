#!/usr/bin/env node
/**
 * Fills your local app with realistic test data by sending HMAC-signed webhooks, exactly as Shopify
 * would: COD orders (incl. a risky one), abandoned checkouts, a shipped and a delivered order,
 * and optionally a privacy data request. Works without Shopify's customer-data approval, because
 * the payloads come from here (real dev-store orders arrive with names/phones hidden until then).
 *
 *   npm run test:webhooks                       # to http://localhost:3000
 *   npm run test:webhooks -- --url https://pingzest-dev.ngrok-free.app
 *   npm run test:webhooks -- --privacy          # also a customers/data_request
 *
 * Needs in .env: SHOPIFY_API_SECRET (Client secret), and the dev store in shopify.app.toml or SHOP=.
 * Abandoned checkouts are back-dated in the database (DATABASE_URL) so they show up immediately.
 */
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

try { process.loadEnvFile(); } catch { /* no .env */ }

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const BASE = (arg("url", process.env.TEST_WEBHOOK_URL || `http://localhost:${process.env.DEV_PORT || 3000}`)).replace(/\/$/, "");
const SECRET = process.env.SHOPIFY_API_SECRET;
const SHOP = process.env.SHOP || (readFileSync("shopify.app.toml", "utf8").match(/dev_store_url\s*=\s*"([^"]+)"/) || [])[1];
if (!SECRET) { console.error("Set SHOPIFY_API_SECRET (the app's Client secret) in .env"); process.exit(1); }
if (!SHOP) { console.error("Set SHOP=your-store.myshopify.com in .env"); process.exit(1); }

async function send(path, topic, payload) {
  const body = JSON.stringify(payload);
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Topic": topic,
      "X-Shopify-Shop-Domain": SHOP,
      "X-Shopify-Hmac-Sha256": createHmac("sha256", SECRET).update(body, "utf8").digest("base64"),
      "X-Shopify-Webhook-Id": randomUUID(),
      "X-Shopify-Event-Id": randomUUID(),
      "X-Shopify-Triggered-At": new Date().toISOString(),
      "X-Shopify-API-Version": "2026-10",
      "ngrok-skip-browser-warning": "1",
    },
    body,
  });
  console.log(`${res.ok ? "✓" : "✗"} ${topic.padEnd(24)} ${res.status}  ${payload.name || payload.token || ""}`);
  if (!res.ok) console.log("   ", (await res.text()).slice(0, 300));
  return res.ok;
}

const run = Date.now() % 100000;
let n = 0;
const id = () => 7_000_000_000 + run * 100 + n++;
const addr = (name, phone, extra = {}) => ({
  first_name: name.split(" ")[0], last_name: name.split(" ")[1] || "", phone,
  address1: "Flat 402, Sunrise Apartments, MG Road", address2: "Near City Mall", city: "Pune", zip: "411001", country_code: "IN", ...extra,
});
function order(name, phone, overrides = {}) {
  const oid = id();
  return {
    id: oid, admin_graphql_api_id: `gid://shopify/Order/${oid}`, name: `#T${oid % 10000}`,
    total_price: "1299.00", currency: "INR", payment_gateway_names: ["Cash on Delivery (COD)"],
    phone, customer: { first_name: name.split(" ")[0], phone }, shipping_address: addr(name, phone),
    line_items: [{ title: "Blue Cotton Kurta", quantity: 1, price: "1299.00" }],
    note_attributes: [{ name: "WhatsApp updates", value: "yes" }],
    created_at: new Date().toISOString(), ...overrides,
  };
}

const orders = [
  order("Priya Shah", "+919000000001"),
  order("Rahul Verma", "+919000000002", { total_price: "2499.00", line_items: [{ title: "Silk Saree", quantity: 1, price: "2499.00" }] }),
  order("Test User", "+919000000003", { total_price: "8999.00", shipping_address: addr("Test User", "+919000000003", { address1: "test", zip: "000000" }) }), // high risk
  order("Anita Rao", "+919000000004", { payment_gateway_names: ["Razorpay"], financial_status: "paid" }), // prepaid, not in COD queue
];
const shipped = order("Kiran Patel", "+919000000005", { payment_gateway_names: ["Razorpay"] });
const delivered = order("Meera Nair", "+919000000006", { payment_gateway_names: ["Razorpay"] });

console.log(`Sending test webhooks to ${BASE} for ${SHOP}\n`);
for (const o of [...orders, shipped, delivered]) await send("/webhooks/orders", "orders/create", o);

const checkouts = [
  { token: `t-${randomUUID()}`, total_price: "1899.00", currency: "INR", phone: "+919000000007", customer: { first_name: "Sneha" }, shipping_address: addr("Sneha Iyer", "+919000000007"), line_items: [{ title: "Linen Shirt", quantity: 2, price: "949.50" }], abandoned_checkout_url: `https://${SHOP}/checkouts/test-recover-1` },
  { token: `t-${randomUUID()}`, total_price: "799.00", currency: "INR", phone: "+919000000008", customer: { first_name: "Arjun" }, shipping_address: addr("Arjun Das", "+919000000008"), line_items: [{ title: "Cotton Dupatta", quantity: 1, price: "799.00" }], abandoned_checkout_url: `https://${SHOP}/checkouts/test-recover-2` },
];
for (const c of checkouts) await send("/webhooks/checkouts", "checkouts/create", c);

await send("/webhooks/fulfillments", "fulfillments/create", { id: id(), order_id: shipped.id, status: "success", tracking_number: "AWB123456789", tracking_urls: ["https://www.delhivery.com/track/package/AWB123456789"] });
await send("/webhooks/fulfillments", "fulfillments/create", { id: id(), order_id: delivered.id, status: "success", tracking_number: "AWB987654321", tracking_urls: ["https://www.delhivery.com/track/package/AWB987654321"] });
await send("/webhooks/fulfillments", "fulfillments/update", { id: id(), order_id: delivered.id, shipment_status: "delivered", tracking_number: "AWB987654321" });

if (args.includes("--privacy")) {
  await send("/webhooks/compliance", "customers/data_request", { shop_domain: SHOP, customer: { id: 1, phone: "+919000000001" }, orders_requested: [String(orders[0].id)], data_request: { id: run } });
}

// Abandoned checkouts appear after the store's delay (default 30 min): back-date them so they show now.
if (process.env.DATABASE_URL) {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const past = new Date(Date.now() - 2 * 3600 * 1000);
    const r = await prisma.checkout.updateMany({ where: { shop: SHOP, token: { in: checkouts.map((c) => c.token) } }, data: { createdAt: past, updatedAt: past } });
    const links = await prisma.order.findMany({ where: { shop: SHOP, shopifyOrderId: { in: orders.slice(0, 3).map((o) => String(o.id)) } }, select: { orderName: true, confirmToken: true } });
    await prisma.$disconnect();
    console.log(`\n↺ Back-dated ${r.count} checkouts so they appear in Abandoned checkouts now.`);
    if (links.length) {
      console.log("\nConfirm pages (open on your phone or browser):");
      for (const l of links) console.log(`  ${l.orderName}: ${BASE}/c/${l.confirmToken}`);
    }
  } catch (e) {
    console.log(`\n(Couldn't reach the database to back-date checkouts: ${e.message})`);
  }
}
console.log("\nOpen the app in your dev store: COD confirmation, Abandoned checkouts and Order updates now have test rows.");
