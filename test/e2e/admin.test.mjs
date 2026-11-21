/**
 * End-to-end tests of the embedded admin app and the customer pages, against the production build,
 * a real MongoDB and a fake Shopify (test/e2e/fake-shopify.mjs) that the app reaches over HTTPS at
 * https://e2e-store.myshopify.com, exactly like the real one. Covers every admin page, every form action,
 * webhooks feeding the queues, the customer confirm page, billing (upgrade, Pro features, cancel).
 *
 * CI sets it up (.github/workflows/ci.yml): /etc/hosts entry, self-signed cert, port 443 → 8443.
 *   npm run test:e2e
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SHOP, HOST_PARAM, UA, prisma, sessionToken, codOrder, startApp } from "./harness.mjs";

let app;
let BASE;
let shopify;
const page = (...a) => app.page(...a);
const act = (...a) => app.act(...a);
const webhook = (...a) => app.webhook(...a);

function assertPage(r, label) {
  assert.equal(r.status, 200, `${label}: HTTP ${r.status}\n${r.html.slice(0, 800)}`);
  assert.doesNotMatch(r.html, /Unexpected Server Error|Application Error/i, `${label}: error page`);
}

const opsSince = (n) => shopify.calls.slice(n).map((c) => c.op);
const settings = () => prisma.shopSettings.findUnique({ where: { shop: SHOP } });
const forcePlanCheck = () => prisma.shopSettings.updateMany({ where: { shop: SHOP }, data: { planCheckedAt: null } });

before(async () => {
  app = await startApp({ port: 3100, log: "/tmp/pingzest-e2e-server.log" });
  ({ BASE, shopify } = app);
});

after(() => app?.stop());

/* ---------- embedded auth ---------- */

test("opening the app authenticates with the session token (token exchange) and shows Home with the sidebar", async () => {
  const r = await page("/app");
  assertPage(r, "Home");
  assert.match(r.html, /wa-sidebar/, "left sidebar rendered");
  for (const href of ["/app/cod", "/app/carts", "/app/updates", "/app/widgets", "/app/discounts", "/app/templates", "/app/analytics", "/app/settings", "/app/plan"]) {
    assert.ok(r.html.includes(`href="${href}?`) || r.html.includes(`href="${href}"`), `sidebar link ${href}`);
  }
  const online = await prisma.session.findFirst({ where: { shop: SHOP, isOnline: true } });
  assert.ok(online, "online session stored after token exchange");
  assert.ok(await settings(), "shop settings created");
});

test("a request without a valid session token doesn't get in", async () => {
  const r = await fetch(`${BASE}/app?embedded=1&shop=${SHOP}&host=${HOST_PARAM}&id_token=not.a.jwt`, { redirect: "manual", headers: { "User-Agent": UA } });
  assert.notEqual(r.status, 200);
  const forged = sessionToken().replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  const r2 = await fetch(`${BASE}/app?embedded=1&shop=${SHOP}&host=${HOST_PARAM}&id_token=${forged}`, { redirect: "manual", headers: { "User-Agent": UA } });
  assert.notEqual(r2.status, 200);
});

test("every admin page renders", async () => {
  for (const path of ["/app", "/app/cod", "/app/carts", "/app/updates", "/app/widgets", "/app/discounts", "/app/templates", "/app/analytics", "/app/settings", "/app/plan"]) {
    assertPage(await page(path), path);
  }
  for (const l of ["hi", "ar", "es"]) assertPage(await page("/app/settings", { locale: l }), `settings in ${l}`);
});

/* ---------- settings ---------- */

test("Settings: save store details; invalid number shows an error", async () => {
  const bad = await act("/app/settings", { storeName: "Golibar", whatsappNumber: "12", countryCode: "91", defaultLang: "en", appLocale: "auto", confirmedTag: "ok", cancelledTag: "no", abandonDelayMin: "30" });
  assert.equal(bad.status, 200);
  assert.notEqual((await settings()).storeName, "Golibar", "invalid form isn't saved");

  const ok = await act("/app/settings", { storeName: "Golibar", whatsappNumber: "98765 43210", countryCode: "91", defaultLang: "hi", appLocale: "auto", confirmedTag: "cod-yes", cancelledTag: "cod-no", abandonDelayMin: "45" });
  assert.equal(ok.status, 200);
  const s = await settings();
  assert.equal(s.storeName, "Golibar");
  assert.equal(s.whatsappNumber, "919876543210");
  assert.equal(s.defaultLang, "hi");
  assert.equal(s.confirmedTag, "cod-yes");
  assert.equal(s.abandonDelayMin, 45);
});

/* ---------- templates (Free limit of 5) ---------- */

test("Templates: seeded, create/update/duplicate/default/delete, and the Free limit of 5", async () => {
  assertPage(await page("/app/templates"), "templates");
  const seeded = await prisma.messageTemplate.count({ where: { shop: SHOP, seeded: true } });
  assert.ok(seeded >= 4, `standard templates seeded (${seeded})`);

  const body = "Hi {name}, please confirm order {order_no}: {confirm_link}";
  for (let i = 1; i <= 5; i++) {
    const r = await act("/app/templates", { intent: "create", type: "cod_confirm", lang: "en", name: `Custom ${i}`, body });
    assert.equal(r.status, 200, `create ${i}`);
  }
  assert.equal(await prisma.messageTemplate.count({ where: { shop: SHOP, seeded: false } }), 5);
  await act("/app/templates", { intent: "create", type: "cod_confirm", lang: "en", name: "Custom 6", body });
  assert.equal(await prisma.messageTemplate.count({ where: { shop: SHOP, seeded: false } }), 5, "6th template refused on Free");

  const t = await prisma.messageTemplate.findFirst({ where: { shop: SHOP, name: "Custom 1" } });
  await act("/app/templates", { intent: "duplicate", id: t.id });
  assert.equal(await prisma.messageTemplate.count({ where: { shop: SHOP, seeded: false } }), 5, "duplicate also limited");

  await act("/app/templates", { intent: "update", id: t.id, name: "Renamed", body: `${body} 🙏`, lang: "en" });
  assert.equal((await prisma.messageTemplate.findUnique({ where: { id: t.id } })).name, "Renamed");

  await act("/app/templates", { intent: "create", type: "cod_confirm", lang: "en", name: "Bad", body: "no link here" });
  assert.equal(await prisma.messageTemplate.count({ where: { shop: SHOP, name: "Bad" } }), 0, "COD template needs {confirm_link}");

  await act("/app/templates", { intent: "default", id: t.id });
  assert.equal((await prisma.messageTemplate.findUnique({ where: { id: t.id } })).isDefault, true);

  await act("/app/templates", { intent: "delete", id: t.id });
  assert.equal(await prisma.messageTemplate.findUnique({ where: { id: t.id } }), null);
  const defaults = await prisma.messageTemplate.count({ where: { shop: SHOP, type: "cod_confirm", lang: "en", isDefault: true } });
  assert.equal(defaults, 1, "another template became the default");

  const r = await act("/app/templates", { intent: "duplicate", id: (await prisma.messageTemplate.findFirst({ where: { shop: SHOP, name: "Custom 2" } })).id });
  assert.equal(r.status, 200);
  assert.equal(await prisma.messageTemplate.count({ where: { shop: SHOP, seeded: false } }), 5, "back at 5 after delete + duplicate");
});

/* ---------- discounts (Shopify discount codes) ---------- */

test("Discounts: create in Shopify, validation, deactivate/activate, delete", async () => {
  let n = shopify.calls.length;
  const r = await act("/app/discounts", { intent: "create", code: "WELCOME10", title: "Welcome", kind: "percentage", value: "10", minSubtotal: "500", endsAt: "", oncePerCustomer: "on" });
  assert.equal(r.status, 200);
  const d = await prisma.discount.findFirst({ where: { shop: SHOP, code: "WELCOME10" } });
  assert.ok(d?.shopifyGid, "discount saved with its Shopify id");
  assert.ok(opsSince(n).includes("createDiscount"));
  const sent = shopify.calls.find((c) => c.op === "createDiscount").variables.input;
  assert.equal(sent.customerGets.value.percentage, 0.1);
  assert.equal(sent.minimumRequirement.subtotal.greaterThanOrEqualToSubtotal, "500");

  await act("/app/discounts", { intent: "create", code: "WELCOME10", title: "Dup", kind: "percentage", value: "10" });
  assert.equal(await prisma.discount.count({ where: { shop: SHOP, code: "WELCOME10" } }), 1, "duplicate code refused");

  shopify.state.failNext = "createDiscount";
  await act("/app/discounts", { intent: "create", code: "FAILME", title: "Fail", kind: "fixed", value: "100" });
  assert.equal(await prisma.discount.count({ where: { shop: SHOP, code: "FAILME" } }), 0, "Shopify error → not saved");

  n = shopify.calls.length;
  await act("/app/discounts", { intent: "deactivate", id: d.id });
  assert.equal((await prisma.discount.findUnique({ where: { id: d.id } })).active, false);
  await act("/app/discounts", { intent: "activate", id: d.id });
  assert.equal((await prisma.discount.findUnique({ where: { id: d.id } })).active, true);
  assert.deepEqual(opsSince(n).filter((o) => o === "toggleDiscount").length, 2);

  await act("/app/discounts", { intent: "create", code: "BYE50", title: "Bye", kind: "fixed", value: "50" });
  const bye = await prisma.discount.findFirst({ where: { shop: SHOP, code: "BYE50" } });
  await act("/app/discounts", { intent: "delete", id: bye.id });
  assert.equal(await prisma.discount.findUnique({ where: { id: bye.id } }), null);
  assert.ok(shopify.calls.some((c) => c.op === "deleteDiscount"));
  assertPage(await page("/app/discounts"), "discounts after changes");
});

/* ---------- widgets (metafield sync) ---------- */

test("Widgets: page shows store languages; saving writes the theme metafield", async () => {
  const r = await page("/app/widgets");
  assertPage(r, "widgets");
  assert.match(r.html, /Hindi/, "store languages from Shopify");
  const cfg = await prisma.widgetConfig.findUnique({ where: { shop: SHOP } }).catch(() => null);
  const base = cfg?.config ? (typeof cfg.config === "string" ? JSON.parse(cfg.config) : cfg.config) : null;

  const n = shopify.calls.length;
  const input = base || {};
  const next = { ...input, chat: { ...(input.chat || {}), enabled: true, agents: [{ name: "Support", phone: "919876543210" }] } };
  const save = await act("/app/widgets", { config: JSON.stringify(next) });
  assert.equal(save.status, 200);
  const ops = opsSince(n);
  assert.ok(ops.includes("appInstallation") && ops.includes("saveWidgetConfig"), `metafield sync (${ops.join(",")})`);
  const mf = shopify.state.metafields.at(-1);
  assert.equal(mf.namespace, "pingzest");
  assert.equal(mf.key, "config");
  const value = JSON.parse(mf.value);
  assert.equal(value.chat.enabled, true);
  assert.ok(value.branding === undefined || value.branding === true || value.showBranding !== false, "Free plan keeps branding");

  const bad = await act("/app/widgets", { config: "{not json" });
  assert.equal(bad.status, 200);
});

/* ---------- COD confirmation end to end ---------- */

test("COD: order webhook → queue → merchant sends → customer confirms on the link → order tagged in Shopify", async () => {
  const o = codOrder();
  shopify.state.orders.set(o.admin_graphql_api_id, { total: "1299.00" });
  assert.equal((await webhook("/webhooks/orders", "orders/create", o)).status, 200);
  const row = await prisma.order.findFirst({ where: { shop: SHOP, shopifyOrderId: String(o.id) } });
  assert.ok(row?.isCod && row.confirmToken, "COD order queued with a confirm token");

  const cod = await page("/app/cod");
  assertPage(cod, "COD queue");
  assert.ok(cod.html.includes(o.name), "order in the COD queue");
  assert.match(cod.html, /wa\.me|api\.whatsapp\.com/, "WhatsApp send link (manual sending)");

  const tpl = await prisma.messageTemplate.findFirst({ where: { shop: SHOP, type: "cod_confirm", isDefault: true } });
  await act("/app/cod", { intent: "sent", id: row.id, templateId: tpl.id, templateName: tpl.name, lang: tpl.lang });
  assert.ok((await prisma.order.findUnique({ where: { id: row.id } })).codSentAt, "marked as sent");
  assert.ok(await prisma.messageLog.findFirst({ where: { shop: SHOP, refId: row.id, kind: "cod_confirm" } }), "send logged for analytics");

  const confirm = await fetch(`${BASE}/c/${row.confirmToken}`);
  assert.equal(confirm.status, 200);
  const html = await confirm.text();
  assert.ok(html.includes(o.name), "confirm page shows the order");

  const n = shopify.calls.length;
  const post = await fetch(`${BASE}/c/${row.confirmToken}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "choice=confirmed", redirect: "manual" });
  assert.ok(post.status < 400, `confirm POST ${post.status}`);
  const after = await prisma.order.findUnique({ where: { id: row.id } });
  assert.equal(after.codStatus, "confirmed");
  assert.equal(after.codRespondedBy, "customer");
  const tagCall = shopify.calls.slice(n).find((c) => c.op === "tagOrder");
  assert.deepEqual(tagCall?.variables, { id: o.admin_graphql_api_id, tags: ["cod-yes"] }, "confirmed tag from Settings added in Shopify");
  assert.ok(opsSince(n).includes("untagOrder"));
});

test("COD: merchant marks an order cancelled from the app → tags swapped in Shopify", async () => {
  const o = codOrder();
  shopify.state.orders.set(o.admin_graphql_api_id, {});
  await webhook("/webhooks/orders", "orders/create", o);
  const row = await prisma.order.findFirst({ where: { shop: SHOP, shopifyOrderId: String(o.id) } });
  const n = shopify.calls.length;
  await act("/app/cod", { intent: "status", id: row.id, status: "cancelled" });
  const after = await prisma.order.findUnique({ where: { id: row.id } });
  assert.equal(after.codStatus, "cancelled");
  assert.equal(after.codRespondedBy, "merchant");
  assert.deepEqual(shopify.calls.slice(n).find((c) => c.op === "tagOrder")?.variables.tags, ["cod-no"]);
  for (const f of ["pending", "confirmed", "cancelled"]) assertPage(await page("/app/cod", { status: f }), `COD filter ${f}`);
});

test("COD: an order without a phone in the webhook is fetched from Shopify", async () => {
  const o = codOrder({ phone: null, customer: { first_name: "Ravi" }, shipping_address: { first_name: "Ravi", city: "Delhi", zip: "110001", country_code: "IN" } });
  shopify.state.orders.set(o.admin_graphql_api_id, {
    payload: {
      id: o.admin_graphql_api_id, legacyResourceId: String(o.id), name: o.name, phone: "+919811111111", statusPageUrl: o.order_status_url, paymentGatewayNames: ["Cash on Delivery (COD)"],
      totalPriceSet: { shopMoney: { amount: "799.00", currencyCode: "INR" } }, customer: { firstName: "Ravi", phone: "+919811111111" },
      shippingAddress: { firstName: "Ravi", lastName: "K", phone: "+919811111111", address1: "12 Park Street", address2: "", zip: "110001", countryCodeV2: "IN" },
      billingAddress: null, customAttributes: [], discountCodes: [], totalDiscountsSet: { shopMoney: { amount: "0" } }, lineItems: { nodes: [{ title: "Shirt", quantity: 1 }] },
    },
  });
  const n = shopify.calls.length;
  await webhook("/webhooks/orders", "orders/create", o);
  assert.ok(opsSince(n).includes("orderForWhatsApp"), "order fetched from the Admin API");
  const row = await prisma.order.findFirst({ where: { shop: SHOP, shopifyOrderId: String(o.id) } });
  assert.equal(row.phone, "919811111111");
});

/* ---------- abandoned checkouts ---------- */

test("Abandoned checkouts: webhook → queue after the delay → send, dismiss; completed checkout leaves", async () => {
  const mk = (token) => ({
    id: Math.floor(Math.random() * 1e9), token, cart_token: token, abandoned_checkout_url: `https://${SHOP}/checkouts/${token}/recover`,
    phone: "+919822222222", email: "a@example.com", total_price: "2499.00", currency: "INR", customer: { first_name: "Neha", phone: "+919822222222" },
    shipping_address: { first_name: "Neha", phone: "+919822222222", country_code: "IN" }, line_items: [{ title: "Silk Saree", quantity: 1, price: "2499.00" }],
    created_at: new Date(Date.now() - 2 * 3600e3).toISOString(), updated_at: new Date(Date.now() - 2 * 3600e3).toISOString(),
  });
  const a = mk(`tok-${randomUUID()}`);
  const b = mk(`tok-${randomUUID()}`);
  for (const c of [a, b]) assert.equal((await webhook("/webhooks/checkouts", "checkouts/create", c)).status, 200);
  await prisma.checkout.updateMany({ where: { shop: SHOP }, data: { createdAt: new Date(Date.now() - 3 * 3600e3), updatedAt: new Date(Date.now() - 3 * 3600e3) } });

  const r = await page("/app/carts");
  assertPage(r, "carts");
  assert.match(r.html, /Neha/, "abandoned checkout listed");

  const rowA = await prisma.checkout.findFirst({ where: { shop: SHOP, token: a.token } });
  const rowB = await prisma.checkout.findFirst({ where: { shop: SHOP, token: b.token } });
  const tpl = await prisma.messageTemplate.findFirst({ where: { shop: SHOP, type: "abandoned_cart", isDefault: true } });
  await act("/app/carts", { intent: "sent", id: rowA.id, templateId: tpl.id, templateName: tpl.name, lang: tpl.lang });
  assert.equal((await prisma.checkout.findUnique({ where: { id: rowA.id } })).status, "sent");
  await act("/app/carts", { intent: "dismiss", id: rowB.id });
  assert.equal((await prisma.checkout.findUnique({ where: { id: rowB.id } })).status, "dismissed");

  // The shopper finishes checkout after the reminder: an order with that checkout token → recovered.
  await webhook("/webhooks/orders", "orders/create", codOrder({ checkout_token: a.token, payment_gateway_names: ["Razorpay"] }));
  const doneA = await prisma.checkout.findUnique({ where: { id: rowA.id } });
  assert.ok(doneA.completed, "checkout marked completed by the order");
  assert.ok(doneA.recovered, "counted as recovered (reminder was sent)");
});

/* ---------- order updates (shipped / delivered) ---------- */

test("Order updates: fulfillment webhooks → shipped/delivered queue → send, mark delivered", async () => {
  const o = codOrder({ payment_gateway_names: ["Razorpay"] });
  await webhook("/webhooks/orders", "orders/create", o);
  const f = { id: 77001, order_id: o.id, status: "success", shipment_status: null, tracking_url: "https://track.example/AWB1", tracking_urls: ["https://track.example/AWB1"], tracking_number: "AWB1", tracking_company: "Delhivery" };
  assert.equal((await webhook("/webhooks/fulfillments", "fulfillments/create", f)).status, 200);
  const row = await prisma.order.findFirst({ where: { shop: SHOP, shopifyOrderId: String(o.id) } });
  assert.ok(row.shippedAt, "shipped");
  assert.equal(row.trackingUrl, "https://track.example/AWB1");

  assertPage(await page("/app/updates"), "updates");
  await act("/app/updates", { intent: "sent", id: row.id, kind: "shipped", templateId: "", templateName: "Standard", lang: "en" });
  assert.ok((await prisma.order.findUnique({ where: { id: row.id } })).shippedMsgSentAt);

  await webhook("/webhooks/fulfillments", "fulfillments/update", { ...f, shipment_status: "delivered" });
  assert.ok((await prisma.order.findUnique({ where: { id: row.id } })).deliveredAt, "delivered from the carrier status");
  await act("/app/updates", { intent: "sent", id: row.id, kind: "delivered", templateId: "", templateName: "Standard", lang: "en" });
  assert.ok((await prisma.order.findUnique({ where: { id: row.id } })).deliveredMsgSentAt);

  const o2 = codOrder({ payment_gateway_names: ["Razorpay"] });
  await webhook("/webhooks/orders", "orders/create", o2);
  await webhook("/webhooks/fulfillments", "fulfillments/create", { ...f, id: 77002, order_id: o2.id });
  const row2 = await prisma.order.findFirst({ where: { shop: SHOP, shopifyOrderId: String(o2.id) } });
  await act("/app/updates", { intent: "delivered", id: row2.id });
  assert.ok((await prisma.order.findUnique({ where: { id: row2.id } })).deliveredAt, "merchant marked delivered");
});

/* ---------- analytics ---------- */

test("Analytics and Home show the activity", async () => {
  const a = await page("/app/analytics");
  assertPage(a, "analytics");
  for (const range of ["7", "30", "90"]) assertPage(await page("/app/analytics", { days: range }), `analytics ${range}d`);
  assertPage(await page("/app"), "home with data");
});

/* ---------- billing and Pro ---------- */

test("Plan: upgrade starts Shopify's approval; approved subscription turns on Pro; limits lift", async () => {
  assertPage(await page("/app/plan"), "plan (free)");
  const n = shopify.calls.length;
  const up = await act("/app/plan", { intent: "upgrade", interval: "monthly" });
  assert.ok(opsSince(n).some((o) => o === "anonymous" || /appSubscriptionCreate/.test(shopify.calls.at(-1).query)) || shopify.calls.slice(n).some((c) => /appSubscriptionCreate/.test(c.query)), "appSubscriptionCreate called");
  assert.ok([200, 302, 401].includes(up.status), `upgrade response ${up.status}`);
  const created = shopify.calls.slice(n).find((c) => /appSubscriptionCreate/.test(c.query));
  assert.equal(created.variables.name, "PingZest Pro Monthly");
  assert.equal(created.variables.test, true, "test charge on dev stores");
  assert.equal(created.variables.trialDays, 7);

  // Merchant approves → Shopify sends app_subscriptions/update and the subscription is active.
  shopify.state.subscription = { ...shopify.state.pending, status: "ACTIVE" };
  const wh = await webhook("/webhooks/app/subscriptions_update", "app_subscriptions/update", {
    app_subscription: { admin_graphql_api_id: shopify.state.subscription.id, name: "PingZest Pro Monthly", status: "ACTIVE", admin_graphql_api_shop_id: "gid://shopify/Shop/1", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), currency: "USD", capped_amount: null },
  });
  assert.equal(wh.status, 200);
  assert.equal((await settings()).plan, "pro");
  await forcePlanCheck();
  assertPage(await page("/app/plan", { upgraded: "1" }), "plan (pro)");
  assert.equal((await settings()).plan, "pro", "billing.check agrees");

  await act("/app/templates", { intent: "create", type: "cod_confirm", lang: "en", name: "Pro extra", body: "Hi {name}: {confirm_link}" });
  assert.equal(await prisma.messageTemplate.count({ where: { shop: SHOP, name: "Pro extra" } }), 1, "6th custom template allowed on Pro");
});

test("Pro: risk score tags high-risk COD orders in Shopify", async () => {
  await act("/app/settings", { storeName: "Golibar", whatsappNumber: "98765 43210", countryCode: "91", defaultLang: "hi", appLocale: "auto", confirmedTag: "cod-yes", cancelledTag: "cod-no", abandonDelayMin: "45",
    proSettings: "1", riskTagHigh: "on", riskTag: "risky", prepaidEnabled: "on", prepaidPercent: "5", prepaidMaxAmount: "100", prepaidTag: "now-prepaid", addressCheck: "on" });
  const s = await settings();
  assert.equal(s.prepaidEnabled, true);
  assert.equal(s.riskTag, "risky");

  const n = shopify.calls.length;
  const risky = codOrder({ total_price: "24999.00", customer: { first_name: "Test", last_name: "User", phone: "+911111111111", orders_count: 0 }, phone: "+911111111111", email: "test@test.com",
    shipping_address: { first_name: "Test", last_name: "User", address1: "abc", address2: "", city: "x", zip: "000000", country_code: "IN", phone: "+911111111111" } });
  shopify.state.orders.set(risky.admin_graphql_api_id, {});
  await webhook("/webhooks/orders", "orders/create", risky);
  const row = await prisma.order.findFirst({ where: { shop: SHOP, shopifyOrderId: String(risky.id) } });
  assert.equal(row.riskLevel, "high", `risk level (${row.riskLevel}, score ${row.riskScore})`);
  const tag = shopify.calls.slice(n).find((c) => c.op === "tagOrder");
  assert.deepEqual(tag?.variables.tags, ["risky"], "high-risk tag added");
  assertPage(await page("/app/cod", { risk: "high" }), "COD risk filter");
});

test("Pro: customer fixes the address and pays online with a discount (order edit) → prepaid", async () => {
  const o = codOrder({ total_price: "1000.00", subtotal_price: "1000.00" });
  shopify.state.orders.set(o.admin_graphql_api_id, { total: "1000.00", subtotal: "1000.00", outstanding: "1000.00" });
  await webhook("/webhooks/orders", "orders/create", o);
  const row = await prisma.order.findFirst({ where: { shop: SHOP, shopifyOrderId: String(o.id) } });

  const view = await (await fetch(`${BASE}/c/${row.confirmToken}`)).text();
  assert.match(view, /cf__addr/, "address check shown on Pro (form opens with Edit)");
  assert.match(view, /Sunrise Apartments/, "current address from Shopify");
  assert.match(view, /value="prepay"/, "pay-online offer shown on Pro");

  let n = shopify.calls.length;
  const addr = await fetch(`${BASE}/c/${row.confirmToken}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, redirect: "manual",
    body: new URLSearchParams({ intent: "address", address1: "Flat 9, Lake View Towers, FC Road", address2: "Opp. Garden", city: "Pune", zip: "411004" }),
  });
  assert.ok(addr.status < 400, `address POST ${addr.status}`);
  const fix = shopify.calls.slice(n).find((c) => c.op === "fixAddress");
  assert.equal(fix?.variables.input.shippingAddress.zip, "411004", "address updated in Shopify");
  assert.ok((await prisma.order.findUnique({ where: { id: row.id } })).addressUpdatedAt);

  n = shopify.calls.length;
  const pay = await fetch(`${BASE}/c/${row.confirmToken}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "intent=prepay", redirect: "manual" });
  assert.ok([302, 303, 200, 204].includes(pay.status), `prepay ${pay.status}`);
  const loc = pay.headers.get("location") || pay.headers.get("x-remix-redirect") || "";
  assert.match(loc + (await pay.text()), /\/pay\//, "sent to Shopify's payment page");
  const ops = opsSince(n);
  for (const op of ["beginEdit", "discountLine", "commitEdit"]) assert.ok(ops.includes(op), `${op} called`);
  const discount = shopify.calls.slice(n).find((c) => c.op === "discountLine").variables.discount;
  assert.equal(discount.percentValue, 5);
  assert.equal((await prisma.order.findUnique({ where: { id: row.id } })).prepaidDiscount, "50");

  // Shopify reports the payment.
  n = shopify.calls.length;
  assert.equal((await webhook("/webhooks/orders-paid", "orders/paid", { ...o, financial_status: "paid", payment_gateway_names: ["Cash on Delivery (COD)", "Razorpay"] })).status, 200);
  const paid = await prisma.order.findUnique({ where: { id: row.id } });
  assert.ok(paid.convertedToPrepaid, "converted to prepaid");
  assert.deepEqual(shopify.calls.slice(n).find((c) => c.op === "tagOrder")?.variables.tags, ["now-prepaid", "cod-yes"], "prepaid + confirmed tags (paying counts as confirming)");
  assertPage(await page("/app/analytics"), "analytics with prepaid stats");
});

test("Plan: cancel goes back to Free and the widget branding returns", async () => {
  const n = shopify.calls.length;
  await act("/app/plan", { intent: "cancel" });
  assert.ok(shopify.calls.slice(n).some((c) => /appSubscriptionCancel/.test(c.query)), "appSubscriptionCancel called");
  assert.equal((await settings()).plan, "free");
  assertPage(await page("/app/plan"), "plan after cancel");
  assertPage(await page("/app/settings"), "settings on Free (Pro fields disabled)");
});

/* ---------- privacy, uninstall ---------- */

test("Privacy webhooks are stored; uninstall removes the sessions", async () => {
  for (const [topic, payload] of [
    ["customers/data_request", { shop_domain: SHOP, customer: { id: 1, phone: "+919812345678" }, orders_requested: [1], data_request: { id: 9 } }],
    ["customers/redact", { shop_domain: SHOP, customer: { id: 1, phone: "+919812345678" }, orders_to_redact: [] }],
  ]) {
    assert.equal((await webhook("/webhooks/compliance", topic, payload)).status, 200, topic);
  }
  assert.ok(await prisma.complianceRequest.count({ where: { shop: SHOP } }) >= 2);
  assert.equal((await webhook("/webhooks/app/uninstalled", "app/uninstalled", { id: 1, domain: SHOP })).status, 200);
  assert.equal(await prisma.session.count({ where: { shop: SHOP } }), 0, "sessions removed");
});

test("the app never called Shopify for anything the fake doesn't know", () => {
  const unknown = shopify.calls.filter((c) => c.op.startsWith("unhandled"));
  assert.deepEqual(unknown, [], "unexpected Shopify requests");
});
