/**
 * Walkthrough screenshots: two ordered flows through the app for an Indian store "Golibar", one screenshot
 * per step (1280×800 JPEG), for turning into GIFs. The element about to be clicked is outlined in the
 * screenshot taken before the click. Phone screens (the customer's confirm page) are shot at 390×844 and
 * centred on a 1280×800 frame. A manifest with a caption per file is written next to them.
 *   free-NN-<slug>.jpg  the store on the Free plan
 *   pro-NN-<slug>.jpg   the same store after upgrading to Pro
 * Output: test/e2e/walkthrough/ (CI prints the files in the log). Same setup as the browser e2e.
 *   npm run walkthrough
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { SHOP, prisma, codOrder, startApp } from "./harness.mjs";
import { newContext } from "./browser-setup.mjs";

const OUT = "test/e2e/walkthrough";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const HOUR = 3600e3;

let app;
let browser;
const manifest = [];
const counters = { free: 0, pro: 0 };
const problems = [];

const ignorable = (text) => /cdn\.shopify\.com|favicon|net::ERR_FAILED|ERR_BLOCKED_BY_CLIENT|Failed to load resource/i.test(text);

async function open(viewport = DESKTOP) {
  const context = await newContext(browser, { viewport });
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`${page.url()} pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !ignorable(m.text())) problems.push(`${page.url()} console: ${m.text().slice(0, 200)}`); });
  return page;
}

async function go(page, path, extra) {
  await page.goto(app.adminUrl(path, extra), { waitUntil: "networkidle" });
  await settle(page);
}

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  if (await page.locator("s-page").count()) await page.locator("#ab-titlebar").waitFor({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(350);
}

/** Outlines the element about to be clicked (3px) and scrolls it into view. */
async function mark(locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.evaluate((el) => { el.dataset.walkMark = "1"; el.style.outline = "3px solid #ff7a00"; el.style.outlineOffset = "2px"; el.style.borderRadius ||= "8px"; });
}
async function unmark(page) {
  await page.evaluate(() => document.querySelectorAll("[data-walk-mark]").forEach((el) => { el.style.outline = ""; el.style.outlineOffset = ""; delete el.dataset.walkMark; }));
}

/** One step: screenshot + manifest entry. */
async function shot(page, flow, slug, title, caption, { phone = false } = {}) {
  counters[flow] += 1;
  const file = `${flow}-${String(counters[flow]).padStart(2, "0")}-${slug}.jpg`;
  if (!phone) {
    await page.screenshot({ path: `${OUT}/${file}`, type: "jpeg", quality: 70 });
  } else {
    // Phone screenshot centred on a 1280×800 frame, so every image in a flow has the same size.
    const png = await page.screenshot({ type: "png" });
    const frame = await browser.newPage({ viewport: DESKTOP });
    await frame.setContent(`<body style="margin:0;height:800px;display:grid;place-items:center;background:#e9e5df">
      <img src="data:image/png;base64,${png.toString("base64")}" style="height:760px;border-radius:28px;box-shadow:0 0 0 10px #1c1c1c,0 18px 40px rgba(0,0,0,.25)"></body>`);
    await frame.screenshot({ path: `${OUT}/${file}`, type: "jpeg", quality: 70 });
    await frame.close();
  }
  await unmark(page);
  manifest.push({ file, flow, step: counters[flow], title, caption });
  console.log(`  WALKSTEP ${file}: ${title}`);
}

async function webhookOrder(o, state = {}) {
  const a = o.shipping_address || {};
  const shippingAddress = { firstName: a.first_name, lastName: a.last_name || "", company: null, address1: a.address1 || "", address2: a.address2 || "", city: a.city || "", provinceCode: "MH", province: "Maharashtra", zip: a.zip || "", countryCodeV2: "IN", country: "India", phone: a.phone || null };
  app.shopify.state.orders.set(o.admin_graphql_api_id, { shippingAddress, ...state });
  assert.equal((await app.webhook("/webhooks/orders", "orders/create", o)).status, 200);
  return prisma.order.findFirst({ where: { shop: SHOP, shopifyOrderId: String(o.id) } });
}

const person = (first, last, phone, extra = {}) => codOrder({
  phone, customer: { first_name: first, last_name: last, phone, orders_count: 1 },
  shipping_address: { first_name: first, last_name: last, address1: "Flat 12, Shanti Niwas, Linking Road", address2: "Near Golibar Maidan", city: "Mumbai", zip: "400055", country_code: "IN", phone },
  ...extra,
});

before(async () => {
  app = await startApp({ port: 3300, log: "/tmp/pingzest-walkthrough.log" });
  browser = await chromium.launch();
  // Store details (as if the merchant had saved them once).
  await app.act("/app/settings", { storeName: "Golibar", whatsappNumber: "", countryCode: "91", defaultLang: "en", appLocale: "auto", confirmedTag: "cod-confirmed", cancelledTag: "cod-cancelled", abandonDelayMin: "30" });

  // COD orders: today's, one risky, one waiting 30 h (to remind), one waiting 80 h (expiry due).
  const items = (title, qty, price) => ({ line_items: [{ title, quantity: qty, price }], total_price: String((qty * Number(price)).toFixed(2)), subtotal_price: String((qty * Number(price)).toFixed(2)) });
  await webhookOrder(person("Priya", "Sharma", "+919820011122", items("Blue Cotton Kurta", 1, "1299.00")));
  await webhookOrder(person("Rahul", "Verma", "+919820033344", items("Silk Dupatta", 2, "749.00")));
  await webhookOrder(person("Sneha", "Patil", "+919820055566", items("Block-print Saree", 1, "2499.00")));
  await webhookOrder(codOrder({
    total_price: "24999.00", subtotal_price: "24999.00", phone: "+911111111111", email: "test@test.com",
    customer: { first_name: "Test", last_name: "User", phone: "+911111111111", orders_count: 0 },
    shipping_address: { first_name: "Test", last_name: "User", address1: "abc", address2: "", city: "x", zip: "000000", country_code: "IN", phone: "+911111111111" },
    line_items: [{ title: "Gold-plated Necklace Set", quantity: 1, price: "24999.00" }],
  }));
  for (const [first, hours] of [["Anjali", 30], ["Vikram", 80]]) {
    const row = await webhookOrder(person(first, "Rao", "+919820077788", items("Handloom Bedsheet", 1, "899.00")));
    await prisma.order.update({ where: { id: row.id }, data: { codStatus: "sent", codSentAt: new Date(Date.now() - hours * HOUR), createdAt: new Date(Date.now() - (hours + 1) * HOUR) } });
  }
  // A shipped prepaid order (Order updates) and an abandoned checkout.
  const shipped = person("Kavya", "Iyer", "+919820099900", { payment_gateway_names: ["Razorpay"], ...items("Kalamkari Kurti", 1, "1099.00") });
  await app.webhook("/webhooks/orders", "orders/create", shipped);
  await app.webhook("/webhooks/fulfillments", "fulfillments/create", { id: 77001, order_id: shipped.id, status: "success", tracking_url: "https://track.example/AWB4411", tracking_urls: ["https://track.example/AWB4411"], tracking_number: "AWB4411", tracking_company: "Delhivery" });
  const token = `tok-walk-${Date.now()}`;
  await app.webhook("/webhooks/checkouts", "checkouts/create", {
    id: 5151, token, cart_token: token, abandoned_checkout_url: `https://${SHOP}/checkouts/${token}/recover`, phone: "+919833344455", total_price: "3299.00", currency: "INR",
    customer: { first_name: "Meera", phone: "+919833344455" }, line_items: [{ title: "Banarasi Silk Saree", quantity: 1, price: "3299.00" }],
  });
  await prisma.checkout.updateMany({ where: { shop: SHOP }, data: { createdAt: new Date(Date.now() - 3 * HOUR), updatedAt: new Date(Date.now() - 3 * HOUR) } });
});

after(async () => {
  writeFileSync(`${OUT}/walkthrough.json`, JSON.stringify({ store: "Golibar", size: "1280x800", steps: manifest }, null, 2));
  await browser?.close();
  await app?.stop();
});

test("FREE plan walkthrough", async () => {
  const page = await open();
  const F = (slug, title, caption, opts) => shot(page, "free", slug, title, caption, opts);

  await go(page, "/app");
  await page.locator("[data-setup-guide]").waitFor();
  await F("home-setup-guide", "Home", "The setup guide puts COD confirmation first, and Today lists the work waiting in each queue.");

  await go(page, "/app/settings");
  await mark(page.locator('s-text-field[name="whatsappNumber"]'));
  await F("settings-store", "Settings: store and WhatsApp", "Settings are grouped by job; the WhatsApp number is the one the merchant sends from.");
  const fill = async (name, value) => { const inner = page.locator(`s-text-field[name="${name}"] input`).first(); if (await inner.count()) await inner.fill(value); else await page.locator(`input[name="${name}"]`).first().fill(value); };
  await fill("whatsappNumber", "98200 12345");
  await page.getByRole("tab", { name: "COD rules" }).click();
  await settle(page);
  const hold = page.locator('s-checkbox[name="codHold"] input').first();
  const holdLabel = page.locator('s-checkbox[name="codHold"] label').first();
  await mark((await holdLabel.count()) ? holdLabel : hold);
  await F("settings-cod-rules", "Settings: COD rules", "Hold fulfillment until the customer confirms, plus reminder and expiry timers and the tags added in Shopify.");
  await hold.click({ force: true });
  await page.locator('ui-save-bar[data-open="true"]').waitFor();
  await mark(page.locator('ui-save-bar button[variant="primary"]'));
  await F("settings-save-bar", "Unsaved changes", "Shopify's save bar appears as soon as something changes; leaving asks first.");
  await page.locator('ui-save-bar button[variant="primary"]').click();
  for (let i = 0; i < 20 && !(await prisma.shopSettings.findUnique({ where: { shop: SHOP } })).codHold; i++) await page.waitForTimeout(250);
  await settle(page);
  await F("settings-saved", "Saved", "Saved: new COD orders are now held in Shopify until the customer confirms.");

  await go(page, "/app/widgets");
  await page.waitForTimeout(800);
  await F("widgets-preview", "Widgets", "The WhatsApp chat button and banner with a live preview of the real storefront widget.");

  await go(page, "/app/cod");
  const next = page.locator("a[data-send-next]");
  await mark(next);
  await F("cod-queue", "COD confirmation", "Each row shows the items, PIN code, age and status. One button sends the next order.");
  const firstId = await next.getAttribute("data-send-next");
  const [popup] = await Promise.all([page.waitForEvent("popup"), next.click()]);
  await popup.close();
  await page.locator("[data-run-progress]").waitFor();
  for (let i = 0; i < 20 && !(await prisma.order.findUnique({ where: { id: firstId } })).codSentAt; i++) await page.waitForTimeout(250);
  await settle(page);
  await F("cod-send-and-next", "Send & next", "WhatsApp opened with the message typed in; the queue moved on to the next order.");

  const sent = await prisma.order.findUnique({ where: { id: firstId } });
  const phone = await open(PHONE);
  await phone.goto(`${app.BASE}/c/${sent.confirmToken}`, { waitUntil: "networkidle" });
  await mark(phone.locator('button[value="confirmed"]'));
  await shot(phone, "free", "confirm-page", "The customer's confirm page", "The store's name, the order, the address and a no-OTP promise; one tap to confirm.", { phone: true });
  await phone.locator('button[value="confirmed"]').click();
  await phone.locator(".cf__result").waitFor();
  await phone.waitForLoadState("networkidle");
  await shot(phone, "free", "confirmed-by-customer", "Confirmed", "The customer confirmed: the order is tagged in Shopify straight away.", { phone: true });
  await phone.context().close();

  await go(page, "/app/cod", { filter: "confirmed" });
  await F("cod-confirmed-tab", "Confirmed orders", "Confirmed orders, under More so the tabs fit on a phone.");
  await go(page, `/app/cod/${firstId}`);
  await F("order-timeline", "Order activity", "Every step of the order: placed, held, sent, confirmed, hold released. With a link to the order in Shopify.");

  await go(page, "/app/cod", { filter: "remind" });
  await F("to-remind", "To remind", "Customers who haven't answered after 24 hours, ready for a reminder message.");

  await go(page, "/app/cod", { filter: "waiting" });
  const expire = page.getByRole("button", { name: "Expire now" }).first();
  await mark(expire);
  await F("expiry-due", "Expiry due", "No reply after 72 hours: expire the order in one click.");
  await expire.click();
  await page.waitForTimeout(800);
  await go(page, "/app/cod", { filter: "no_reply" });
  const row = page.locator("s-table-body s-table-row").first();
  await row.locator("[data-rowmenu]").click();
  const cancel = page.locator(".wa-menu--floating").getByRole("button", { name: "Cancel in Shopify" });
  await mark(cancel);
  await F("row-menu", "More actions", "Less common actions sit in each row's menu.");
  await cancel.click();
  await page.locator("dialog[open]").waitFor();
  await F("cancel-modal", "Cancel in Shopify?", "Destructive actions ask first in a modal, never a browser popup.");
  await page.locator("dialog[open]").getByRole("button", { name: "Cancel order" }).click();
  await page.waitForTimeout(1000);
  await settle(page);
  await F("cancelled-in-shopify", "Cancelled in Shopify", "The order is cancelled in Shopify and the items go back in stock.");

  await go(page, "/app/carts");
  const dismiss = page.getByRole("button", { name: "Dismiss" }).first();
  await mark(dismiss);
  await F("abandoned-checkouts", "Abandoned checkouts", "Shoppers who left checkout, with the cart and a ready recovery message.");
  await dismiss.click();
  await page.waitForTimeout(800);
  await go(page, "/app/carts", { filter: "dismissed" });
  const restore = page.getByRole("button", { name: "Restore" }).first();
  await mark(restore);
  await F("dismissed", "Dismissed", "Dismissed checkouts can be brought back.");
  await restore.click();
  await page.waitForTimeout(800);
  await go(page, "/app/carts");
  await F("restored", "Restored", "Back in the To send list.");

  await go(page, "/app/updates");
  await F("order-updates", "Order updates", "Shipping and delivery messages, with the courier's tracking link.");

  for (let i = 1; i <= 5; i++) await app.act("/app/templates", { intent: "create", type: "cod_confirm", lang: "en", name: `Golibar ${i}`, body: "Namaste {name}! Please confirm your order {order_no} ({amount}): {confirm_link}" });
  await go(page, "/app/templates");
  await page.locator("[data-template-limit]").scrollIntoViewIfNeeded();
  await F("templates-limit", "Message templates", "Five custom templates are included on Free; the Standard ones are always there.");

  await go(page, "/app/analytics");
  await F("analytics-returns", "Analytics: Returns", "What COD confirmation saved; the breakdowns by PIN code and more are on Pro.");

  await go(page, "/app/settings/plan");
  await F("plan", "Plan", "Free vs Pro, with the store's own savings first. Billed by Shopify.");
  assert.deepEqual(problems, [], "no errors during the Free walkthrough");
  await page.context().close();
});

test("PRO plan walkthrough", async () => {
  const page = await open();
  const P = (slug, title, caption, opts) => shot(page, "pro", slug, title, caption, opts);

  await go(page, "/app/settings/plan");
  const trial = page.getByRole("button", { name: /free trial/ });
  await mark(trial);
  await P("plan-start-trial", "Start the Pro trial", "Upgrading opens Shopify's own approval page.");
  // The merchant approves on Shopify (the fake Shopify approves and sends the webhook).
  await app.act("/app/settings/plan", { intent: "upgrade", interval: "monthly" });
  app.shopify.state.subscription = { ...app.shopify.state.pending, status: "ACTIVE" };
  await app.webhook("/webhooks/app/subscriptions_update", "app_subscriptions/update", {
    app_subscription: { admin_graphql_api_id: app.shopify.state.subscription.id, name: "PingZest Pro Monthly", status: "ACTIVE", admin_graphql_api_shop_id: "gid://shopify/Shop/1", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), currency: "USD", capped_amount: null },
  });
  assert.equal((await prisma.shopSettings.findUnique({ where: { shop: SHOP } })).plan, "pro");
  await go(page, "/app/settings/plan", { upgraded: "1" });
  await P("plan-pro", "You're on Pro", "Back from Shopify: the store is on Pro.");

  await app.act("/app/settings", {
    storeName: "Golibar", whatsappNumber: "98200 12345", countryCode: "91", defaultLang: "en", appLocale: "auto", confirmedTag: "cod-confirmed", cancelledTag: "cod-cancelled", abandonDelayMin: "30",
    loopSettings: "1", codHold: "on", codRemindHours: "24", codExpireHours: "72", noReplyTag: "cod-no-reply", cancelRestock: "on", loopPro: "1", codAutoExpire: "on", cancelOnExpire: "on",
    proSettings: "1", riskTagHigh: "on", riskTag: "risky-cod", prepaidEnabled: "on", prepaidPercent: "5", prepaidMaxAmount: "100", prepaidTag: "paid-online", addressCheck: "on",
  });
  await go(page, "/app/settings", { tab: "cod" });
  await page.getByRole("heading", { name: /COD money-savers/ }).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.locator('s-checkbox[name="prepaidEnabled"]').scrollIntoViewIfNeeded();
  await P("settings-money-savers", "COD money-savers", "Pro turns on the risk tag, pay-online-with-a-discount, the address check and the autopilot.");

  // A new risky order arrives on Pro.
  const risky = await webhookOrder(codOrder({
    total_price: "18999.00", subtotal_price: "18999.00", phone: "+911111111112", email: "test@test.com",
    customer: { first_name: "Test", last_name: "Buyer", phone: "+911111111112", orders_count: 0 },
    shipping_address: { first_name: "Test", last_name: "Buyer", address1: "xyz", address2: "", city: "x", zip: "000000", country_code: "IN", phone: "+911111111112" },
    line_items: [{ title: "Smartwatch", quantity: 3, price: "6333.00" }],
  }));
  await go(page, "/app/cod", { sort: "risk" });
  await P("risky-order-flagged", "Risky orders flagged", "Pro scores every COD order and says why; sorted by risk, highest first.");
  await go(page, "/app/cod", { risk: "high" });
  await P("risk-filter", "High risk only", "Filter the queue to high-risk orders to call or ask for prepaid first.");
  assert.ok((await prisma.order.findUnique({ where: { id: risky.id } })).riskLevel);

  // Customer: fixes the address and pays online with a discount.
  const o = person("Pooja", "Nair", "+919820044433", { total_price: "2000.00", subtotal_price: "2000.00", line_items: [{ title: "Chanderi Silk Saree", quantity: 1, price: "2000.00" }] });
  const row = await webhookOrder(o, { total: "2000.00", subtotal: "2000.00", outstanding: "2000.00" });
  const phone = await open(PHONE);
  await phone.goto(`${app.BASE}/c/${row.confirmToken}`, { waitUntil: "networkidle" });
  await shot(phone, "pro", "confirm-page-pro", "Confirm page on Pro", "On Pro the customer can fix the address or pay online with a discount.", { phone: true });
  await mark(phone.locator(".cf__link").first());
  await shot(phone, "pro", "fix-address", "Fix the address", "A wrong landmark is a common reason parcels come back.", { phone: true });
  await phone.locator(".cf__link").first().click();
  await phone.locator('input[name="address2"]').fill("Opp. Golibar Maidan, near HDFC Bank");
  await shot(phone, "pro", "address-form", "Address form", "The customer adds a landmark.", { phone: true });
  await phone.getByRole("button", { name: /Save address/ }).click();
  await phone.waitForLoadState("networkidle");
  await phone.locator(".cf__note--ok").waitFor().catch(() => {});
  await shot(phone, "pro", "address-saved", "Address updated", "The address is updated on the Shopify order.", { phone: true });
  const pay = phone.locator(".cf__btn--pay");
  await mark(pay);
  await shot(phone, "pro", "pay-online", "Pay online and save", "Paying online now takes 5% off and removes the COD risk.", { phone: true });
  await phone.context().close();
  // The tap goes to Shopify's payment page; then Shopify reports the payment.
  const prepay = await fetch(`${app.BASE}/c/${row.confirmToken}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "intent=prepay", redirect: "manual" });
  assert.ok(prepay.status < 400);
  await app.webhook("/webhooks/orders-paid", "orders/paid", { ...o, financial_status: "paid", payment_gateway_names: ["Cash on Delivery (COD)", "Razorpay"] });
  await go(page, `/app/cod/${row.id}`);
  await P("paid-online", "Paid online", "The order switched to prepaid: tagged in Shopify, no COD parcel at risk.");

  // Autopilot: an order unanswered for 80 hours is expired and cancelled when the app opens.
  const late = await webhookOrder(person("Arjun", "Mehta", "+919820066611", { line_items: [{ title: "Cotton Kurta Set", quantity: 1, price: "1499.00" }] }));
  await prisma.order.update({ where: { id: late.id }, data: { codStatus: "sent", codSentAt: new Date(Date.now() - 80 * HOUR) } });
  await prisma.shopSettings.update({ where: { shop: SHOP }, data: { codProcessedAt: null } });
  await go(page, "/app");
  for (let i = 0; i < 40 && !(await prisma.order.findUnique({ where: { id: late.id } })).shopifyCancelledAt; i++) await page.waitForTimeout(250);
  await go(page, "/app/cod", { filter: "no_reply" });
  await P("autopilot-cancelled", "Autopilot", "Unanswered after 72 hours: expired, tagged and cancelled in Shopify automatically.");

  await go(page, "/app/analytics", { view: "returns", days: "90" });
  const csv = page.getByRole("button", { name: "Export CSV" });
  await mark(csv);
  await P("returns-breakdowns", "Where returns come from", "Cancel, no-reply and return rates by PIN code, first order, coupon and time; export to CSV.");

  await app.act("/app/templates", { intent: "create", type: "cod_confirm", lang: "en", name: "Golibar 6", body: "Hi {name}, confirm {order_no}: {confirm_link}" });
  await go(page, "/app/templates");
  await P("templates-unlimited", "Unlimited templates", "No template limit on Pro.");

  await go(page, "/app/settings/plan");
  const cancelPro = page.getByRole("button", { name: "Cancel Pro" });
  await mark(cancelPro);
  await P("plan-manage", "Manage Pro", "Pro can be cancelled any time from the Plan page.");
  await cancelPro.click();
  await page.locator("dialog[open]").waitFor();
  await P("cancel-pro-modal", "Cancel Pro?", "Cancelling asks first; Shopify credits the unused time.");
  await page.locator("dialog[open]").getByRole("button", { name: "Keep Pro" }).click();
  assert.deepEqual(problems, [], "no errors during the Pro walkthrough");
  await page.context().close();
});

test("walkthrough files and manifest", () => {
  const free = manifest.filter((m) => m.flow === "free");
  const pro = manifest.filter((m) => m.flow === "pro");
  assert.ok(free.length >= 20, `Free steps (${free.length})`);
  assert.ok(pro.length >= 14, `Pro steps (${pro.length})`);
  for (const m of manifest) {
    const head = readFileSync(`${OUT}/${m.file}`).subarray(0, 3);
    assert.deepEqual([...head], [0xff, 0xd8, 0xff], `${m.file} is a JPEG`);
    assert.ok(m.title && m.caption);
  }
});
