/**
 * Browser end-to-end: real Chromium opens the embedded admin with a stand-in for Shopify's App Bridge
 * (it hands the app a session token and adds it to the app's requests, like App Bridge does), clicks
 * through every page from the left sidebar, saves Settings from the form, checks the mobile menu, and
 * uses the customer confirm page like a shopper. Fails on any page error, hydration error or console error.
 * Screenshots go to test/e2e/screenshots/ (uploaded by CI).
 *   npm run test:e2e:browser   (after npm run build; same CI setup as test:e2e)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { SHOP, UA, prisma, sessionToken, codOrder, startApp } from "./harness.mjs";

const SHOTS = "test/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

let app;
let browser;
const problems = [];

// Errors from outside the app (blocked Shopify CDN scripts, favicon) don't count.
const ignorable = (text) => /cdn\.shopify\.com|favicon|net::ERR_FAILED|ERR_BLOCKED_BY_CLIENT|Failed to load resource/i.test(text);

async function newPage({ mobile = false } = {}) {
  const context = await browser.newContext({
    userAgent: UA, // headless Chrome's own user agent counts as a bot for Shopify's library
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 },
    deviceScaleFactor: 1,
  });
  await context.exposeFunction("__e2eToken", () => sessionToken({ ttl: 300 }));
  // Stand-in for App Bridge: shopify.idToken() and the session token on every same-origin request.
  await context.addInitScript(() => {
    window.shopify = {
      idToken: () => window.__e2eToken(),
      config: {}, environment: { embedded: true },
      toast: { show: (m) => console.log(`[toast] ${m}`) },
      loading: () => {}, saveBar: { show() {}, hide() {} }, modal: { show() {}, hide() {} },
    };
    const original = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      if (url.origin === location.origin) {
        const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined));
        headers.set("Authorization", `Bearer ${await window.__e2eToken()}`);
        init = { ...init, headers };
      }
      return original(input, init);
    };
  });
  // Shopify's CDN scripts (App Bridge, Polaris) are replaced by the stand-in above.
  await context.route("https://cdn.shopify.com/**", (route) => {
    const u = route.request().url();
    if (u.endsWith(".js")) return route.fulfill({ status: 200, contentType: "application/javascript", body: "/* stubbed in e2e */" });
    if (u.endsWith(".css")) return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`${page.url()} pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !ignorable(m.text())) problems.push(`${page.url()} console: ${m.text().slice(0, 300)}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500 && r.url().startsWith(app.BASE)) problems.push(`${r.url()} HTTP ${r.status()}`);
    if (r.url().startsWith(app.BASE) && r.request().resourceType() !== "document" && !/\/assets\//.test(r.url())) {
      console.log(`  [net] ${r.request().method()} ${r.url().replace(app.BASE, "").split("?")[0]} → ${r.status()}`);
    }
  });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) console.log(`  [nav] ${f.url().replace(app.BASE, "").split("?")[0]}`); });
  return page;
}

before(async () => {
  app = await startApp({ port: 3200, log: "/tmp/pingzest-e2e-browser.log" });
  browser = await chromium.launch();

  // Data so every page has something to show.
  const cod = codOrder();
  app.shopify.state.orders.set(cod.admin_graphql_api_id, {});
  await app.webhook("/webhooks/orders", "orders/create", cod);
  const shipped = codOrder({ payment_gateway_names: ["Razorpay"] });
  await app.webhook("/webhooks/orders", "orders/create", shipped);
  await app.webhook("/webhooks/fulfillments", "fulfillments/create", { id: 88001, order_id: shipped.id, status: "success", tracking_url: "https://track.example/AWB9", tracking_urls: ["https://track.example/AWB9"], tracking_number: "AWB9", tracking_company: "Delhivery" });
  const token = `tok-browser-${Date.now()}`;
  await app.webhook("/webhooks/checkouts", "checkouts/create", {
    id: 4242, token, cart_token: token, abandoned_checkout_url: `https://${SHOP}/checkouts/${token}/recover`, phone: "+919822222222", total_price: "2499.00", currency: "INR",
    customer: { first_name: "Neha", phone: "+919822222222" }, line_items: [{ title: "Silk Saree", quantity: 1, price: "2499.00" }],
  });
  await prisma.checkout.updateMany({ where: { shop: SHOP }, data: { createdAt: new Date(Date.now() - 3 * 3600e3), updatedAt: new Date(Date.now() - 3 * 3600e3) } });
});

after(async () => {
  await browser?.close();
  await app?.stop();
});

const PAGES = [
  ["Home", "/app"],
  ["COD confirmation", "/app/cod"],
  ["Abandoned checkouts", "/app/carts"],
  ["Order updates", "/app/updates"],
  ["Widgets", "/app/widgets"],
  ["Discounts", "/app/discounts"],
  ["Message templates", "/app/templates"],
  ["Analytics", "/app/analytics"],
  ["Settings", "/app/settings"],
  ["Plan", "/app/plan"],
];

test("every page opens from the left sidebar without errors", async () => {
  const page = await newPage();
  await page.goto(app.adminUrl("/app"), { waitUntil: "networkidle" });
  await page.locator(".wa-sidebar").waitFor();
  assert.ok(await page.locator(".wa-sidebar").isVisible(), "sidebar visible on desktop");

  for (const [label, path] of PAGES) {
    await page.locator(".wa-sidebar").getByRole("link", { name: label, exact: true }).click();
    await page.waitForURL((u) => new URL(u).pathname === path, { timeout: 15000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    const active = await page.locator(".wa-sidebar__link.is-active").allInnerTexts();
    const heading = await page.locator("h1, .wa-page__title").first().innerText().catch(() => "(no heading)");
    console.log(`  ${label}: url=${new URL(page.url()).pathname} active=${JSON.stringify(active)} heading=${JSON.stringify(heading)}`);
    if (!active.some((t) => t.includes(label))) await page.screenshot({ path: `${SHOTS}/FAIL-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    assert.ok(active.some((t) => t.includes(label)), `${label} highlighted in the sidebar (active: ${JSON.stringify(active)})`);
    const body = await page.locator("body").innerText();
    assert.doesNotMatch(body, /Application Error|Unexpected Server Error|Something went wrong/i, `${label} rendered`);
    await page.screenshot({ path: `${SHOTS}/${path.replace(/\//g, "_").replace(/^_/, "") || "app"}.png`, fullPage: true });
  }
  assert.deepEqual(problems, [], "no page, hydration or console errors");
  await page.context().close();
});

test("Settings saves from the form in the browser", async () => {
  const page = await newPage();
  await page.goto(app.adminUrl("/app/settings"), { waitUntil: "networkidle" });
  await page.locator('input[name="storeName"]').fill("Golibar Browser");
  await page.locator('input[name="whatsappNumber"]').fill("98765 43210");
  await page.locator('input[name="storeName"]').press("Enter");
  for (let i = 0; i < 20; i++) {
    const s = await prisma.shopSettings.findUnique({ where: { shop: SHOP } });
    if (s?.storeName === "Golibar Browser") break;
    await page.waitForTimeout(250);
  }
  const s = await prisma.shopSettings.findUnique({ where: { shop: SHOP } });
  assert.equal(s.storeName, "Golibar Browser");
  assert.equal(s.whatsappNumber, "919876543210");
  assert.deepEqual(problems, [], "no errors while saving");
  await page.context().close();
});

test("on a phone the sidebar becomes a Menu button", async () => {
  const page = await newPage({ mobile: true });
  await page.goto(app.adminUrl("/app"), { waitUntil: "networkidle" });
  assert.equal(await page.locator(".wa-sidebar").isVisible(), false, "sidebar hidden until opened");
  await page.locator(".wa-sidebar__toggle").click();
  assert.ok(await page.locator(".wa-sidebar").isVisible(), "menu opens");
  await page.screenshot({ path: `${SHOTS}/mobile-menu.png`, fullPage: true });
  await page.locator(".wa-sidebar").getByRole("link", { name: "COD confirmation", exact: true }).click();
  await page.waitForURL((u) => new URL(u).pathname === "/app/cod");
  await page.waitForLoadState("networkidle");
  await page.locator(".wa-sidebar").waitFor({ state: "hidden", timeout: 3000 });
  assert.equal(await page.locator(".wa-sidebar").isVisible(), false, "menu closes after navigating");
  assert.match(await page.locator("h1, .wa-page__title").first().innerText(), /COD/, "COD page shown");
  assert.deepEqual(problems, []);
  await page.context().close();
});

test("customer confirms the order on the confirm page (phone)", async () => {
  const order = await prisma.order.findFirst({ where: { shop: SHOP, isCod: true, codStatus: "pending" } });
  const page = await newPage({ mobile: true });
  await page.goto(`${app.BASE}/c/${order.confirmToken}`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${SHOTS}/confirm-before.png`, fullPage: true });
  await page.locator('button[value="confirmed"]').click();
  await page.locator(".cf__result").waitFor();
  await page.screenshot({ path: `${SHOTS}/confirm-after.png`, fullPage: true });
  assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).codStatus, "confirmed");
  assert.ok(app.shopify.calls.some((c) => c.op === "tagOrder"), "order tagged in Shopify");
  assert.deepEqual(problems, []);
  await page.context().close();
});
