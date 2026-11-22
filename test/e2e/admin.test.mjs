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
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { SHOP, HOST_PARAM, UA, SECRET, CRON_SECRET, prisma, sessionToken, codOrder, startApp } from "./harness.mjs";

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
const BASE_SETTINGS = { storeName: "Golibar", whatsappNumber: "98765 43210", countryCode: "91", defaultLang: "hi", appLocale: "auto", confirmedTag: "cod-yes", cancelledTag: "cod-no", abandonDelayMin: "45" };
const LOOP_SETTINGS = { loopSettings: "1", codRemindHours: "24", codExpireHours: "72", noReplyTag: "cod-silent", cancelRestock: "on" };
const HOUR = 3600e3;
const orderRow = (o) => prisma.order.findFirst({ where: { shop: SHOP, shopifyOrderId: String(o.id) } });
const confirmPost = (token, body) => fetch(`${BASE}/c/${token}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, redirect: "manual" });
/** A COD order that arrived through the webhook and whose confirmation was sent `hoursAgo`. */
async function sentCodOrder(hoursAgo = 0, overrides = {}) {
  const o = codOrder(overrides);
  shopify.state.orders.set(o.admin_graphql_api_id, {});
  await webhook("/webhooks/orders", "orders/create", o);
  const row = await orderRow(o);
  await act("/app/cod", { intent: "sent", id: row.id, templateId: "", templateName: "Standard", lang: "en" });
  await prisma.order.update({ where: { id: row.id }, data: { codSentAt: new Date(Date.now() - hoursAgo * HOUR) } });
  return { o, row: await prisma.order.findUnique({ where: { id: row.id } }) };
}
const forcePlanCheck = () => prisma.shopSettings.updateMany({ where: { shop: SHOP }, data: { planCheckedAt: null } });

before(async () => {
  app = await startApp({ port: 3100, log: "/tmp/pingzest-e2e-server.log" });
  ({ BASE, shopify } = app);
});

after(() => app?.stop());

/* ---------- embedded auth ---------- */

test("opening the app authenticates with the session token (token exchange) and shows Home; Shopify's admin menu is the only navigation", async () => {
  const r = await page("/app");
  assertPage(r, "Home");
  assert.doesNotMatch(r.html, /wa-sidebar/, "no second menu inside the app (Built for Shopify 4.1.4)");
  const menu = r.html.slice(r.html.indexOf("<ui-nav-menu"), r.html.indexOf("</ui-nav-menu>"));
  assert.ok(menu.length > 0, "NavMenu rendered");
  const hrefs = [...menu.matchAll(/href="([^"?]+)/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ["/app", "/app/cod", "/app/carts", "/app/updates", "/app/templates", "/app/widgets", "/app/analytics", "/app/settings"], "home link + 7 items, COD first");
  assert.match(menu, /rel="home"/);
  assert.doesNotMatch(menu, /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u, "no emoji in the menu");
  const online = await prisma.session.findFirst({ where: { shop: SHOP, isOnline: true } });
  assert.ok(online, "online session stored after token exchange");
  assert.ok(await settings(), "shop settings created");
});

test("old Plan and Discounts addresses redirect to their new place under Settings and Widgets", async () => {
  for (const [from, to] of [["/app/plan", "/app/settings/plan"], ["/app/discounts", "/app/widgets/discounts"]]) {
    const r = await page(from, { upgraded: "1" });
    assert.ok([301, 302].includes(r.status), `${from} redirects (${r.status})`);
    const loc = new URL(r.headers.get("location"), BASE);
    assert.equal(loc.pathname, to);
    assert.equal(loc.searchParams.get("upgraded"), "1", "query kept");
  }
});

test("a request without a valid session token doesn't get in", async () => {
  const r = await fetch(`${BASE}/app?embedded=1&shop=${SHOP}&host=${HOST_PARAM}&id_token=not.a.jwt`, { redirect: "manual", headers: { "User-Agent": UA } });
  assert.notEqual(r.status, 200);
  // Tampered token: another staff member's id, same signature.
  const [h, , sig] = sessionToken().split(".");
  const body = Buffer.from(JSON.stringify({ iss: `https://${SHOP}/admin`, dest: `https://${SHOP}`, aud: "ci-api-key", sub: "999", exp: Math.floor(Date.now() / 1000) + 60, nbf: 0, iat: 0, jti: "x", sid: "x" })).toString("base64url");
  const forged = `${h}.${body}.${sig}`;
  const r2 = await fetch(`${BASE}/app?embedded=1&shop=${SHOP}&host=${HOST_PARAM}&id_token=${forged}`, { redirect: "manual", headers: { "User-Agent": UA } });
  assert.notEqual(r2.status, 200);
});

test("every admin page renders", async () => {
  for (const path of ["/app", "/app/cod", "/app/carts", "/app/updates", "/app/widgets", "/app/widgets/discounts", "/app/templates", "/app/analytics", "/app/settings", "/app/settings/plan"]) {
    assertPage(await page(path), path);
  }
  for (const l of ["hi", "ar", "es"]) assertPage(await page("/app/settings", { locale: l }), `settings in ${l}`);
});

test("every admin page in all 7 languages: translated admin menu, lang attribute, right-to-left for Arabic", async () => {
  const PAGES = ["/app", "/app/cod", "/app/carts", "/app/updates", "/app/widgets", "/app/widgets/discounts", "/app/templates", "/app/analytics", "/app/settings", "/app/settings/plan"];
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");
  for (const l of ["en", "hi", "es", "pt-BR", "fr", "de", "ar"]) {
    const dict = l === "en" ? {} : JSON.parse(readFileSync(`app/i18n/locales/${l}.json`, "utf8"));
    for (const path of PAGES) {
      const r = await page(path, { locale: l });
      assertPage(r, `${path} in ${l}`);
      assert.ok(r.html.includes(`lang="${l}" dir="${l === "ar" ? "rtl" : "ltr"}"`), `${path} in ${l}: lang and direction`);
      for (const key of ["Abandoned checkouts", "Templates"]) {
        const text = dict[key] || key;
        assert.ok(r.html.includes(text) || r.html.includes(esc(text)), `${path} in ${l}: menu shows "${text}"`);
      }
    }
  }
});

test("Home setup guide: five COD-first steps that tick themselves, theme embed status, dismiss", async () => {
  let home = await page("/app");
  assertPage(home, "home");
  assert.match(home.html, /data-setup-guide/);
  for (const step of ["number", "firstSend", "hold", "cost", "embed"]) assert.match(home.html, new RegExp(`data-step="${step}"`), `step ${step}`);
  assert.match(home.html, /data-step="embed" data-done="0"/);
  await act("/app?index", { intent: "embedStatus", active: "1" });
  await act("/app?index", { intent: "holdOn" });
  assert.equal((await act("/app?index", { intent: "rtoCost", rtoCost: "550" })).status, 200);
  const s = await settings();
  assert.equal(s.codHold, true);
  assert.equal(s.rtoCost, 550);
  home = await page("/app");
  assert.match(home.html, /data-step="embed" data-done="1"/, "embed reported active");
  assert.match(home.html, /data-step="hold" data-done="1"/);
  assert.match(home.html, /data-step="cost" data-done="1"/);
  assert.match(home.html, /Store widgets are live/);
  await act("/app?index", { intent: "embedStatus", active: "0" });
  assert.match((await page("/app")).html, /data-step="embed" data-done="0"/, "embed turned off again");
  await act("/app?index", { intent: "dismissSetup" });
  assert.doesNotMatch((await page("/app")).html, /data-setup-guide/, "dismissed");
  await act("/app?index", { intent: "showSetup" });
  assert.match((await page("/app")).html, /data-setup-guide/);
  await prisma.shopSettings.update({ where: { shop: SHOP }, data: { codHold: false, rtoCost: null } });
});

test("sample confirm page for \"Send a test to yourself\" changes nothing; unknown shops get 404", async () => {
  const r = await fetch(`${BASE}/c/sample?shop=${SHOP}`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /#1001/);
  assert.match(html, /never ask for an OTP/);
  const post = await fetch(`${BASE}/c/sample?shop=${SHOP}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "choice=cancelled", redirect: "manual" });
  assert.ok(post.status < 400);
  assert.equal((await fetch(`${BASE}/c/sample?shop=nope.myshopify.com`)).status, 404);
  assert.equal((await fetch(`${BASE}/c/sample`)).status, 404);
});

/* ---------- settings ---------- */

test("Settings: save store details; invalid number shows an error", async () => {
  const bad = await act("/app/settings", { storeName: "Golibar", whatsappNumber: "12", countryCode: "91", defaultLang: "en", appLocale: "auto", confirmedTag: "ok", cancelledTag: "no", abandonDelayMin: "30" });
  assert.equal(bad.status, 200);
  assert.notEqual((await settings()).storeName, "Golibar", "invalid form isn't saved");

  await act("/app/settings", { storeName: "Golibar", whatsappNumber: "98765 43210", countryCode: "91", logoUrl: "javascript:alert(1)" });
  assert.notEqual((await settings()).logoUrl, "javascript:alert(1)", "only https logos");
  const ok = await act("/app/settings", { storeName: "Golibar", whatsappNumber: "98765 43210", countryCode: "91", defaultLang: "hi", appLocale: "auto", confirmedTag: "cod-yes", cancelledTag: "cod-no", abandonDelayMin: "45", logoUrl: "https://cdn.example.com/logo.png" });
  assert.equal(ok.status, 200);
  const s = await settings();
  assert.equal(s.storeName, "Golibar");
  assert.equal(s.whatsappNumber, "919876543210");
  assert.equal(s.defaultLang, "hi");
  assert.equal(s.confirmedTag, "cod-yes");
  assert.equal(s.abandonDelayMin, 45);
  assert.equal(s.logoUrl, "https://cdn.example.com/logo.png");
  assert.match((await page("/app/settings")).html, /Signed in with Shopify/, "account shown; no sign-out in the embedded app");
  assert.doesNotMatch((await page("/app/settings")).html, /Sign out/);
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
  assert.match((await page("/app/templates")).html, /data-template-limit/, "Free limit message on the list");

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

  // Each template opens in its own page; new ones from the standard text; the 5-template limit shows on the list.
  const c2 = await prisma.messageTemplate.findFirst({ where: { shop: SHOP, name: "Custom 2" } });
  const editor = await page(`/app/templates/${c2.id}`);
  assertPage(editor, "template editor page");
  assert.match(editor.html, /Custom 2/);
  assert.match(editor.html, /slot="breadcrumb-actions"/);
  assertPage(await page("/app/templates/new", { type: "cod_reminder", lang: "hi", from: "standard" }), "new template page");
  assert.equal((await page("/app/templates/000000000000000000000000")).status, 404);
  const viaEditor = await act(`/app/templates/${c2.id}`, { intent: "update", id: c2.id, name: "Custom 2", body: `${body} !`, lang: "en" });
  assert.equal(viaEditor.status, 200);
  assert.ok((await prisma.messageTemplate.findUnique({ where: { id: c2.id } })).body.endsWith("!"), "saved from the editor page");

  const r = await act("/app/templates", { intent: "duplicate", id: (await prisma.messageTemplate.findFirst({ where: { shop: SHOP, name: "Custom 2" } })).id });
  assert.equal(r.status, 200);
  assert.equal(await prisma.messageTemplate.count({ where: { shop: SHOP, seeded: false } }), 5, "back at 5 after delete + duplicate");
});

/* ---------- discounts (Shopify discount codes) ---------- */

test("Discounts: create in Shopify, validation, deactivate/activate, delete", async () => {
  let n = shopify.calls.length;
  const r = await act("/app/widgets/discounts", { intent: "create", code: "WELCOME10", title: "Welcome", kind: "percentage", value: "10", minSubtotal: "500", endsAt: "", oncePerCustomer: "on" });
  assert.equal(r.status, 200);
  const d = await prisma.discount.findFirst({ where: { shop: SHOP, code: "WELCOME10" } });
  assert.ok(d?.shopifyGid, "discount saved with its Shopify id");
  assert.ok(opsSince(n).includes("createDiscount"));
  const sent = shopify.calls.find((c) => c.op === "createDiscount").variables.input;
  assert.equal(sent.customerGets.value.percentage, 0.1);
  assert.equal(sent.minimumRequirement.subtotal.greaterThanOrEqualToSubtotal, "500");

  await act("/app/widgets/discounts", { intent: "create", code: "WELCOME10", title: "Dup", kind: "percentage", value: "10" });
  assert.equal(await prisma.discount.count({ where: { shop: SHOP, code: "WELCOME10" } }), 1, "duplicate code refused");

  shopify.state.failNext = "createDiscount";
  await act("/app/widgets/discounts", { intent: "create", code: "FAILME", title: "Fail", kind: "fixed", value: "100" });
  assert.equal(await prisma.discount.count({ where: { shop: SHOP, code: "FAILME" } }), 0, "Shopify error → not saved");

  n = shopify.calls.length;
  await act("/app/widgets/discounts", { intent: "deactivate", id: d.id });
  assert.equal((await prisma.discount.findUnique({ where: { id: d.id } })).active, false);
  await act("/app/widgets/discounts", { intent: "activate", id: d.id });
  assert.equal((await prisma.discount.findUnique({ where: { id: d.id } })).active, true);
  assert.deepEqual(opsSince(n).filter((o) => o === "toggleDiscount").length, 2);

  await act("/app/widgets/discounts", { intent: "create", code: "BYE50", title: "Bye", kind: "fixed", value: "50" });
  const bye = await prisma.discount.findFirst({ where: { shop: SHOP, code: "BYE50" } });
  await act("/app/widgets/discounts", { intent: "delete", id: bye.id });
  assert.equal(await prisma.discount.findUnique({ where: { id: bye.id } }), null);
  assert.ok(shopify.calls.some((c) => c.op === "deleteDiscount"));
  assertPage(await page("/app/widgets/discounts"), "discounts after changes");
  assertPage(await page("/app/widgets/discounts/new"), "create discount page");
  await act("/app/widgets/discounts/new", { intent: "create", code: "PAGE20", title: "", kind: "percentage", value: "20" });
  assert.ok(await prisma.discount.findFirst({ where: { shop: SHOP, code: "PAGE20" } }), "created from its own page");
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

  assert.equal(row.confirmToken.length, 22, "128-bit confirm token");
  const timeline = await page(`/app/cod/${row.id}`);
  assertPage(timeline, "order timeline");
  assert.match(timeline.html, /data-event="created"/);
  assert.match(timeline.html, /data-event="sent"/);
  assert.ok(timeline.html.includes(`/admin/orders/${o.id}`), "link to the order in Shopify");
  assert.equal((await page("/app/cod/000000000000000000000000")).status, 404);
  for (const sort of ["newest", "value", "risk", "bogus"]) assertPage(await page("/app/cod", { sort }), `COD sorted by ${sort}`);

  const confirm = await fetch(`${BASE}/c/${row.confirmToken}?l=en`);
  assert.equal(confirm.status, 200);
  const html = await confirm.text();
  assert.ok(html.includes(o.name), "confirm page shows the order");
  assert.match(html, /pay the courier in cash/, "cash on delivery line");
  assert.match(html, /never ask for an OTP/, "no-OTP line");
  assert.match(html, /Sunrise Apartments/, "address shown on Free (read-only)");
  assert.doesNotMatch(html, /name="address1"/, "no address editing on Free");

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

test("COD: bulk mark confirmed and returned (RTO); cancelled-in-Shopify orders are skipped", async () => {
  const made = [];
  for (let i = 0; i < 2; i++) {
    const o = codOrder();
    shopify.state.orders.set(o.admin_graphql_api_id, {});
    await webhook("/webhooks/orders", "orders/create", o);
    made.push(await orderRow(o));
  }
  const n = shopify.calls.length;
  const r = await act("/app/cod", { intent: "bulk", op: "confirmed", ids: made.map((m) => m.id).join(",") });
  assert.equal(r.status, 200);
  for (const m of made) assert.equal((await prisma.order.findUnique({ where: { id: m.id } })).codStatus, "confirmed");
  assert.equal(shopify.calls.slice(n).filter((c) => c.op === "tagOrder").length, 2, "each order tagged");
  await act("/app/cod", { intent: "bulk", op: "rto", ids: made.map((m) => m.id).join(",") });
  for (const m of made) assert.ok((await prisma.order.findUnique({ where: { id: m.id } })).rtoAt, "marked returned");
  for (const m of made) await act("/app/cod", { intent: "rto", id: m.id, on: "0" });
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


/* ---------- closing the COD loop (docs/TICKETS.md PZ-01..03) ---------- */

test("COD loop (Free): fulfillment held on arrival and released when the customer confirms", async () => {
  await act("/app/settings", { ...BASE_SETTINGS, ...LOOP_SETTINGS, codHold: "on" });
  const s = await settings();
  assert.equal(s.codHold, true);
  assert.equal(s.noReplyTag, "cod-silent");
  assert.equal(s.cancelRestock, true);
  assert.equal(s.codAutoExpire, false, "autopilot fields ignored on Free");

  const o = codOrder();
  shopify.state.orders.set(o.admin_graphql_api_id, {});
  let n = shopify.calls.length;
  await webhook("/webhooks/orders", "orders/create", o);
  assert.ok(opsSince(n).includes("codFulfillmentOrders") && opsSince(n).includes("holdFulfillmentOrder"), `hold calls (${opsSince(n).join(",")})`);
  const hold = shopify.calls.slice(n).find((c) => c.op === "holdFulfillmentOrder").variables.fulfillmentHold;
  assert.equal(hold.reason, "OTHER");
  assert.equal(hold.notifyMerchant, false);
  const row = await orderRow(o);
  assert.ok(row.heldAt, "order marked held");
  assert.equal(row.fulfillmentHolds.length, 1);
  const fo = shopify.state.orders.get(o.admin_graphql_api_id).fulfillmentOrders[0];
  assert.equal(fo.status, "ON_HOLD", "fulfillment order on hold in Shopify");
  assert.match((await page("/app/cod")).html, /Fulfillment on hold/);

  n = shopify.calls.length;
  const post = await confirmPost(row.confirmToken, "choice=confirmed");
  assert.ok(post.status < 400);
  const release = shopify.calls.slice(n).find((c) => c.op === "releaseFulfillmentHold");
  assert.deepEqual(release?.variables, { id: fo.id, holdIds: [row.fulfillmentHolds[0].hold] }, "only PingZest's hold is released");
  assert.equal(fo.status, "OPEN");
  assert.ok((await orderRow(o)).holdReleasedAt, "release recorded");
});

test("COD loop (Free): Release hold and Hold fulfillment buttons; Dismiss clears a failed-action alert", async () => {
  await act("/app/settings", { ...BASE_SETTINGS, ...LOOP_SETTINGS, codHold: "on" });
  const o = codOrder();
  shopify.state.orders.set(o.admin_graphql_api_id, {});
  await webhook("/webhooks/orders", "orders/create", o);
  const row = await orderRow(o);
  assert.ok(row.heldAt);
  assert.match((await page("/app/cod")).html, /Release hold/);
  let n = shopify.calls.length;
  await act("/app/cod", { intent: "release", id: row.id });
  assert.ok(opsSince(n).includes("releaseFulfillmentHold"));
  assert.ok((await orderRow(o)).holdReleasedAt, "released by hand");
  const fo = shopify.state.orders.get(o.admin_graphql_api_id).fulfillmentOrders[0];
  assert.equal(fo.status, "OPEN");

  // Hold again by hand (the order is pending and not shipped).
  await prisma.order.update({ where: { id: row.id }, data: { holdReleasedAt: null, heldAt: null } });
  n = shopify.calls.length;
  await act("/app/cod", { intent: "hold", id: row.id });
  assert.ok(opsSince(n).includes("holdFulfillmentOrder"));
  assert.equal(fo.status, "ON_HOLD");

  shopify.state.failNext = "releaseFulfillmentHold";
  await act("/app/cod", { intent: "release", id: row.id });
  assert.match((await orderRow(o)).actionError || "", /^release: /);
  await act("/app/cod", { intent: "dismissError", id: row.id });
  assert.equal((await orderRow(o)).actionError, null, "dismissed");
  await act("/app/cod", { intent: "status", id: row.id, status: "cancelled" });
});

test("COD loop (Free): a failed hold shows on the order and Retry fixes it", async () => {
  const o = codOrder();
  shopify.state.orders.set(o.admin_graphql_api_id, {});
  shopify.state.failNext = "holdFulfillmentOrder";
  await webhook("/webhooks/orders", "orders/create", o);
  const row = await orderRow(o);
  assert.match(row.actionError || "", /^hold: Fake failure/, "error stored, webhook still answered");
  assert.match((await page("/app/cod")).html, /Couldn(?:'|&#x27;|&#39;)t hold fulfillment/);
  await act("/app/cod", { intent: "retry", id: row.id });
  const after = await orderRow(o);
  assert.ok(after.heldAt, "held on retry");
  assert.equal(after.actionError, null, "alert cleared");
});

test("COD loop (Free): remind after 24h, expire by hand with the no-reply tag, cancel + restock in Shopify by hand", async () => {
  const { o, row } = await sentCodOrder(25);
  const remindTab = await page("/app/cod", { filter: "remind", lang: "en" });
  assertPage(remindTab, "To remind tab");
  assert.ok(remindTab.html.includes(o.name), "order listed in To remind");
  assert.match(remindTab.html, /Send reminder/);
  assert.match(remindTab.html, /quick%20reminder/, "WhatsApp link uses the reminder template");
  const tpl = await prisma.messageTemplate.findFirst({ where: { shop: SHOP, type: "cod_reminder", lang: "en", isDefault: true } });
  assert.ok(tpl, "standard reminder template seeded");
  await act("/app/cod", { intent: "reminded", id: row.id, templateId: tpl.id, templateName: tpl.name, lang: "en" });
  assert.ok((await orderRow(o)).codRemindedAt, "reminder recorded");
  assert.ok(await prisma.messageLog.findFirst({ where: { shop: SHOP, refId: row.id, kind: "cod_reminder" } }), "reminder in message analytics");
  assert.ok(!(await page("/app/cod", { filter: "remind" })).html.includes(o.name), "reminded orders leave To remind");

  await prisma.order.update({ where: { id: row.id }, data: { codSentAt: new Date(Date.now() - 73 * HOUR) } });
  assert.match((await page("/app/cod", { filter: "waiting" })).html, /Expire now/, "expiry due shown");
  let n = shopify.calls.length;
  await act("/app/cod", { intent: "status", id: row.id, status: "no_reply" });
  const expired = await orderRow(o);
  assert.equal(expired.codStatus, "no_reply");
  assert.ok(expired.codExpiredAt);
  assert.deepEqual(shopify.calls.slice(n).find((c) => c.op === "tagOrder")?.variables.tags, ["cod-silent"], "no-reply tag added");
  assert.ok(!opsSince(n).includes("cancelOrder"), "Free never cancels on its own");

  n = shopify.calls.length;
  await act("/app/cod", { intent: "cancelShopify", id: row.id });
  const cancel = shopify.calls.slice(n).find((c) => c.op === "cancelOrder");
  assert.equal(cancel?.variables.orderId, o.admin_graphql_api_id);
  assert.equal(cancel.variables.restock, true, "restocked (Settings)");
  assert.equal(cancel.variables.reason, "OTHER");
  assert.equal(cancel.variables.notifyCustomer, false);
  assert.ok((await orderRow(o)).shopifyCancelledAt);
  assert.ok(shopify.state.orders.get(o.admin_graphql_api_id).cancelledAt, "cancelled in Shopify");

  n = shopify.calls.length;
  await act("/app/cod", { intent: "cancelShopify", id: row.id });
  assert.ok(!opsSince(n).includes("cancelOrder"), "never cancelled twice");

  // Cancelled in Shopify is final: the merchant can't mark it confirmed again (that tagged a cancelled order).
  n = shopify.calls.length;
  await act("/app/cod", { intent: "status", id: row.id, status: "confirmed" });
  assert.equal((await orderRow(o)).codStatus, "no_reply", "status kept after the Shopify cancel");
  assert.ok(!opsSince(n).includes("tagOrder"), "no confirmed tag on a cancelled order");
  const noReplyTab = (await page("/app/cod", { filter: "no_reply" })).html;
  const card = noReplyTab.slice(noReplyTab.indexOf(o.name), noReplyTab.indexOf(o.name) + 4000);
  assert.match(card, /Cancelled in Shopify/);
  assert.doesNotMatch(card.split("</s-table-row>")[0], /Mark confirmed|Send again/, "no status or send buttons on a cancelled order");

  const view = await (await fetch(`${BASE}/c/${row.confirmToken}?l=en`)).text();
  assert.match(view, /This order was cancelled/, "confirm page says it's cancelled");
  assert.equal((await confirmPost(row.confirmToken, "choice=confirmed")).status, 400, "can't confirm a cancelled order");

  // A shipped order is never cancelled.
  const { o: o2, row: row2 } = await sentCodOrder(1);
  await act("/app/cod", { intent: "status", id: row2.id, status: "cancelled" });
  await prisma.order.update({ where: { id: row2.id }, data: { shippedAt: new Date() } });
  n = shopify.calls.length;
  await act("/app/cod", { intent: "cancelShopify", id: row2.id });
  assert.ok(!opsSince(n).includes("cancelOrder"), "shipped order not cancelled");
  assert.equal((await orderRow(o2)).shopifyCancelledAt, null);

  await act("/app/settings", { ...BASE_SETTINGS, ...LOOP_SETTINGS }); // hold off again for the other tests
  assert.equal((await settings()).codHold, false);
});


/* ---------- returns: saved on returns, RTO facts, breakdowns (PZ-04..06) ---------- */

test("Returns (Free): order facts saved, return cost setting, saved-on-returns headline, RTO mark; breakdowns stay Pro", async () => {
  await act("/app/settings", { ...BASE_SETTINGS, ...LOOP_SETTINGS, rtoCost: "600" });
  assert.equal((await settings()).rtoCost, 600);

  const o = codOrder({ created_at: "2026-11-21T23:40:00+05:30", customer: { first_name: "Asha", phone: "+919800000001", orders_count: 1 }, phone: "+919800000001", discount_codes: [{ code: "WELCOME10" }] });
  shopify.state.orders.set(o.admin_graphql_api_id, {});
  await webhook("/webhooks/orders", "orders/create", o);
  const row = await orderRow(o);
  assert.equal(row.firstOrder, true, "first order from orders_count");
  assert.equal(row.placedHour, 23, "hour in the store's time");
  assert.equal(row.discountCodes, "WELCOME10");

  // Without orders_count, the store's own orders decide.
  const again = codOrder({ customer: { first_name: "Asha", phone: "+919800000001" }, phone: "+919800000001" });
  await webhook("/webhooks/orders", "orders/create", again);
  assert.equal((await orderRow(again)).firstOrder, false, "second order from the same phone");

  const home = await page("/app");
  assertPage(home, "home with savings");
  assert.match(home.html, /Saved on returns/);
  assert.match(home.html, /₹[\d,]+/, "amount in the store currency");

  const r = await page("/app/analytics", { view: "returns" });
  assertPage(r, "analytics returns (free)");
  assert.match(r.html, /Parcels you didn(?:'|&#x27;|&#39;)t ship/);
  assert.match(r.html, /Returns insights are on Pro/);
  assert.doesNotMatch(r.html, /By PIN code/, "no breakdowns on Free");
  assert.doesNotMatch(r.html, /"pincodes"/, "breakdown data never sent to a Free page");

  await act("/app/cod", { intent: "status", id: row.id, status: "confirmed" });
  await act("/app/cod", { intent: "rto", id: row.id, on: "1" });
  assert.ok((await orderRow(o)).rtoAt, "marked returned");
  assert.match((await page("/app/cod", { filter: "confirmed" })).html, /Not returned/);
  await act("/app/cod", { intent: "rto", id: row.id, on: "0" });
  assert.equal((await orderRow(o)).rtoAt, null, "undo");
  await act("/app/cod", { intent: "rto", id: row.id, on: "1" });

  const plan = await page("/app/settings/plan");
  assertPage(plan, "plan with savings");
  assert.match(plan.html, /Zero markup/);
  assert.match(plan.html, /saved you about/, "store's own savings on the Plan page");
});


/* ---------- alerts for stuck work (PZ-07, PZ-08) ---------- */

test("Alerts: failed Shopify action, unsent and phoneless COD orders, stalled shipment → Home banner + badge; Retry and Mark delivered clear them", async () => {
  // A tag that Shopify refuses.
  const { o, row } = await sentCodOrder(1);
  shopify.state.failNext = "tagOrder";
  await act("/app/cod", { intent: "status", id: row.id, status: "confirmed" });
  assert.match((await orderRow(o)).actionError || "", /^tag: /, "failed tag recorded");

  // Not sent for 13 hours, and an order without any phone.
  const late = codOrder();
  await webhook("/webhooks/orders", "orders/create", late);
  await prisma.order.update({ where: { id: (await orderRow(late)).id }, data: { createdAt: new Date(Date.now() - 13 * HOUR) } });
  const nophone = codOrder({ phone: null, customer: { first_name: "Nobody" }, shipping_address: { first_name: "Nobody", address1: "12 Park Street", city: "Delhi", zip: "110001", country_code: "IN" } });
  await webhook("/webhooks/orders", "orders/create", nophone);
  assert.equal((await orderRow(nophone)).phone, null);

  // Shipped 8 days ago, never delivered.
  const shipped = codOrder({ payment_gateway_names: ["Razorpay"] });
  await webhook("/webhooks/orders", "orders/create", shipped);
  await webhook("/webhooks/fulfillments", "fulfillments/create", { id: 99001, order_id: shipped.id, status: "success", tracking_url: "https://track.example/AWB7", tracking_urls: ["https://track.example/AWB7"], tracking_number: "AWB7", tracking_company: "Delhivery" });
  const shippedRow = await orderRow(shipped);
  await prisma.order.update({ where: { id: shippedRow.id }, data: { shippedAt: new Date(Date.now() - 8 * 24 * HOUR) } });

  const home = await page("/app");
  assertPage(home, "home with alerts");
  assert.match(home.html, /Needs attention/);
  assert.match(home.html, /data-alert="failed"/);
  assert.match(home.html, /Couldn(?:'|&#x27;|&#39;)t tag the order/);
  assert.match(home.html, /data-alert="notSent"/);
  assert.match(home.html, /data-alert="noPhone"/);
  assert.match(home.html, /data-alert="stalled"/);
  assert.ok(home.html.includes(shipped.name), "stalled shipment listed");
  assert.match(home.html, /data-today="cod"/, "Today card lists the COD orders to send");
  assert.match((await page("/app/cod")).html, /No valid WhatsApp number on this order/, "COD queue explains the missing number");

  // Retry (Home posts to /app/cod) and Mark delivered (posts to /app/updates) clear them.
  await act("/app/cod", { intent: "retry", id: row.id });
  assert.equal((await orderRow(o)).actionError, null, "retry worked");
  await act("/app/updates", { intent: "delivered", id: shippedRow.id });
  const after = await page("/app");
  assert.doesNotMatch(after.html, /data-alert="failed"/);
  assert.doesNotMatch(after.html, /data-alert="stalled"/);

  // Tidy up for the tests after this one.
  await act("/app/cod", { intent: "status", id: (await orderRow(late)).id, status: "cancelled" });
  await act("/app/cod", { intent: "status", id: (await orderRow(nophone)).id, status: "cancelled" });
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
  const dismissedTab = await page("/app/carts", { filter: "dismissed" });
  assertPage(dismissedTab, "carts dismissed tab");
  assert.match(dismissedTab.html, /Neha/, "dismissed checkout listed with Restore");
  await act("/app/carts", { intent: "restore", id: rowB.id });
  assert.equal((await prisma.checkout.findUnique({ where: { id: rowB.id } })).status, "pending", "restored to To send");
  await act("/app/carts", { intent: "dismiss", id: rowB.id });

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
  assertPage(await page("/app/settings/plan"), "plan (free)");
  const n = shopify.calls.length;
  const up = await act("/app/settings/plan", { intent: "upgrade", interval: "monthly" });
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
  const proWidget = JSON.parse(shopify.state.metafields.at(-1).value);
  assert.equal(proWidget.branding, false, "plan change re-syncs the storefront widget without “Powered by PingZest”");
  await forcePlanCheck();
  assertPage(await page("/app/settings/plan", { upgraded: "1" }), "plan (pro)");
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
  const high = await page("/app/cod", { risk: "high" });
  assertPage(high, "COD risk filter");
  assert.ok(high.html.includes(risky.name), "risky order under High risk");
  assert.match(high.html, /High risk/);
  assert.ok(!(await page("/app/cod", { risk: "low" })).html.includes(risky.name), "not under Low risk");
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

test("Returns (Pro): breakdowns by PIN code, first order, coupon and hour, confirmed vs not, CSV export", async () => {
  const r = await page("/app/analytics", { view: "returns", days: "90" });
  assertPage(r, "analytics returns (pro)");
  for (const text of ["Where returns come from", "Confirmed vs not confirmed", "First order vs repeat", "Order time", "Export CSV"]) {
    assert.ok(r.html.includes(text), `returns page shows ${text}`);
  }
  assert.match(r.html, /First order/);
  assert.match(r.html, /Used a coupon/);
  assert.match(r.html, /Shipped without confirmation|Confirmed before shipping/);
});

test("COD autopilot (Pro): expires unanswered orders on app load and by cron, cancels + restocks; customer cancel cancels", async () => {
  await act("/app/settings", { ...BASE_SETTINGS, ...LOOP_SETTINGS, loopPro: "1", codAutoExpire: "on", cancelOnCustomer: "on", cancelOnExpire: "on" });
  const s = await settings();
  assert.equal(s.codAutoExpire, true);
  assert.equal(s.cancelOnExpire, true);
  assert.equal(s.cancelOnCustomer, true);

  const { o, row } = await sentCodOrder(80);
  await prisma.shopSettings.update({ where: { shop: SHOP }, data: { codProcessedAt: null } });
  let n = shopify.calls.length;
  assertPage(await page("/app"), "home runs the autopilot");
  // It runs after the page is sent (so it never slows the page down): wait for it.
  for (let i = 0; i < 40 && (await orderRow(o)).codStatus !== "no_reply"; i++) await new Promise((r) => setTimeout(r, 250));
  const expired = await orderRow(o);
  assert.equal(expired.codStatus, "no_reply", "expired automatically");
  assert.ok(expired.codExpiredAt);
  assert.ok(expired.shopifyCancelledAt, "cancelled in Shopify (opt-in)");
  assert.deepEqual(shopify.calls.slice(n).find((c) => c.op === "tagOrder")?.variables.tags, ["cod-silent"]);
  const cancel = shopify.calls.slice(n).find((c) => c.op === "cancelOrder");
  assert.equal(cancel?.variables.restock, true);
  assert.equal(row.codStatus, "sent");

  // Throttled: a second load within 10 minutes doesn't run it again.
  const { o: o2 } = await sentCodOrder(80);
  await page("/app");
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((await orderRow(o2)).codStatus, "sent", "throttled");

  // The cron endpoint runs it for every Pro shop with the autopilot on (needs the secret).
  assert.equal((await fetch(`${BASE}/cron/cod`, { method: "POST" })).status, 401);
  assert.equal((await fetch(`${BASE}/cron/cod`, { method: "POST", headers: { Authorization: "Bearer wrong-secret-wrong-secret" } })).status, 401);
  const cron = await fetch(`${BASE}/cron/cod`, { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  assert.equal(cron.status, 200);
  const summary = await cron.json();
  assert.ok(summary.expired >= 1, `cron expired orders (${JSON.stringify(summary)})`);
  assert.equal((await orderRow(o2)).codStatus, "no_reply", "expired by cron");

  // Customer cancels on the confirm page → cancelled in Shopify straight away.
  const { o: o3, row: row3 } = await sentCodOrder(1);
  n = shopify.calls.length;
  await confirmPost(row3.confirmToken, "choice=cancelled");
  const c3 = shopify.calls.slice(n).find((c) => c.op === "cancelOrder");
  assert.equal(c3?.variables.reason, "CUSTOMER");
  assert.ok((await orderRow(o3)).shopifyCancelledAt);

  // Turn the autopilot off again.
  await act("/app/settings", { ...BASE_SETTINGS, ...LOOP_SETTINGS, loopPro: "1" });
  assert.equal((await settings()).codAutoExpire, false);
});

test("Plan: cancel goes back to Free and the widget branding returns", async () => {
  const n = shopify.calls.length;
  await act("/app/settings/plan", { intent: "cancel" });
  assert.ok(shopify.calls.slice(n).some((c) => /appSubscriptionCancel/.test(c.query)), "appSubscriptionCancel called");
  assert.equal((await settings()).plan, "free");
  assert.equal(JSON.parse(shopify.state.metafields.at(-1).value).branding, true, "branding back on the storefront widget");
  assertPage(await page("/app/settings/plan"), "plan after cancel");
  assertPage(await page("/app/settings"), "settings on Free (Pro fields disabled)");
});

/* ---------- storefront widgets → app proxy ---------- */

/** Shopify's app proxy signature: hex HMAC-SHA256 of the sorted "key=value" pairs, concatenated. */
function proxyQuery(extra = {}) {
  const params = { shop: SHOP, logged_in_customer_id: "", path_prefix: "/apps/pingzest", timestamp: String(Math.floor(Date.now() / 1000)), ...extra };
  const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("");
  const signature = createHmac("sha256", SECRET).update(message).digest("hex");
  return new URLSearchParams({ ...params, signature }).toString();
}

test("Storefront widget beacons through the app proxy are counted; unsigned ones are ignored", async () => {
  const beacon = JSON.stringify({ pageType: "product", device: "mobile", events: [{ widget: "chat", event: "view" }, { widget: "chat", event: "click" }, { widget: "nope", event: "view" }] });
  const ok = await fetch(`${BASE}/proxy/track?${proxyQuery()}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: beacon });
  assert.equal(ok.status, 204);
  const rows = await prisma.widgetEvent.findMany({ where: { shop: SHOP, pageType: "product", device: "mobile" } });
  assert.deepEqual(rows.map((r) => `${r.widget}:${r.event}`).sort(), ["chat:click", "chat:view"]);

  const forged = await fetch(`${BASE}/proxy/track?shop=${SHOP}&timestamp=1&signature=deadbeef`, { method: "POST", body: beacon });
  assert.equal(forged.status, 204);
  assert.equal(await prisma.widgetEvent.count({ where: { shop: SHOP, pageType: "product", device: "mobile", widget: "chat", event: "view", count: 2 } }), 0, "forged beacon not counted");
  assertPage(await page("/app/analytics"), "analytics with widget stats");
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
  const invalid = shopify.calls.filter((c) => c.op === "graphql_error").map((c) => c.variables);
  assert.deepEqual(invalid, [], "every Admin API query and its variables are valid for the real Shopify schema");
  if (process.env.CI) assert.ok(process.env.E2E_ADMIN_SCHEMA, "schema validation is on in CI");
});
