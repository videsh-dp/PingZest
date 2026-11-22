/**
 * Browser end-to-end: real Chromium opens the embedded admin with a stand-in for Shopify's App Bridge
 * (it hands the app a session token and adds it to the app's requests, like App Bridge does, and records
 * save bar calls), opens every page, and checks the new UI behaviour: setup guide (auto-complete from the
 * theme embed status, dismiss), Today links, COD "Send & next", row menus and modals, the save bar with its
 * leave guard, the order timeline, the phone layout, and the customer confirm page (cancel asks first).
 * Fails on any page error, hydration error or console error.
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
      toast: { show: (m) => { window.__toasts = [...(window.__toasts || []), m]; console.log(`[toast] ${m}`); } },
      loading: () => {},
      saveBar: { show(id) { window.__saveBar = { id, open: true }; }, hide(id) { window.__saveBar = { id, open: false }; } },
      modal: { show() {}, hide() {} },
      // The PingZest app embed is on in the live theme (what Shopify reports for a set-up store).
      app: { extensions: async () => [{ handle: "pingzest-widgets", type: "theme_app_extension", activations: [{ target: "body", handle: "app-embed", name: "PingZest", status: "active", activations: [] }] }] },
    };
    // Shopify's admin title bar: App Bridge shows the s-page heading, breadcrumb and header buttons above
    // the app (Polaris hides them inside the iframe). The stand-in draws the same bar at the top of the page;
    // its buttons click the app's own elements, like App Bridge does.
    const drawTitleBar = () => {
      // Only after React has hydrated: adding nodes earlier would make hydration fail.
      if (document.documentElement.dataset.hydrated !== "1") return;
      const pageEl = document.querySelector("s-page");
      let bar = document.getElementById("ab-titlebar");
      if (!pageEl) { bar?.remove(); return; }
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "ab-titlebar";
        bar.style.cssText = "position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:8px;padding:10px 16px;background:#ebebeb;border-bottom:1px solid #d4d4d4;font:600 14px -apple-system,Segoe UI,Roboto,sans-serif;color:#303030";
        document.body.prepend(bar);
      }
      const items = [...pageEl.querySelectorAll(':scope > [slot="breadcrumb-actions"], :scope > [slot="primary-action"], :scope > [slot="secondary-actions"]')];
      const key = pageEl.getAttribute("heading") + "|" + items.map((i) => i.slot + i.textContent + i.getAttribute("href")).join("|");
      if (bar.dataset.key === key) return;
      bar.dataset.key = key;
      bar.textContent = "";
      const proxy = (el, style) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = el.textContent.trim();
        b.dataset.proxy = el.slot;
        b.style.cssText = style;
        b.addEventListener("click", () => el.click());
        return b;
      };
      for (const el of items.filter((i) => i.slot === "breadcrumb-actions")) {
        const b = proxy(el, "border:0;background:none;color:#616161;font:inherit;cursor:pointer;padding:0");
        b.textContent = `${b.textContent} ›`;
        bar.append(b);
      }
      const h = document.createElement("span");
      h.textContent = pageEl.getAttribute("heading") || "";
      h.dataset.heading = "";
      h.style.cssText = "flex:1";
      bar.append(h);
      for (const el of items.filter((i) => i.slot === "secondary-actions")) bar.append(proxy(el, "border:1px solid #c9c9c9;background:#fff;border-radius:8px;padding:5px 10px;font:inherit;font-size:13px;cursor:pointer"));
      for (const el of items.filter((i) => i.slot === "primary-action")) bar.append(proxy(el, "border:0;background:#303030;color:#fff;border-radius:8px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer"));
    };
    new MutationObserver(() => drawTitleBar()).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["heading", "href", "data-hydrated"] });
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
  // WhatsApp links open in a new tab: answer them locally instead of going to wa.me.
  await context.route(/https:\/\/(wa\.me|api\.whatsapp\.com)\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>WhatsApp</title>" }));
  // App Bridge is replaced by the stand-in above; Polaris web components (polaris.js) load for real, so the
  // screenshots show real Polaris rendering.
  await context.route("https://cdn.shopify.com/**", (route) => {
    const u = route.request().url();
    if (/app-bridge\.js/.test(u)) return route.fulfill({ status: 200, contentType: "application/javascript", body: "/* App Bridge stubbed in e2e */" });
    return route.continue();
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
  // Two more COD orders, so "Send & next" has somewhere to go.
  for (const name of ["Rahul", "Anita"]) {
    const o = codOrder({ customer: { first_name: name, phone: "+919811122233", orders_count: 2 }, line_items: [{ title: "Cotton Saree", quantity: 2, price: "649.50" }] });
    app.shopify.state.orders.set(o.admin_graphql_api_id, {});
    await app.webhook("/webhooks/orders", "orders/create", o);
  }
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
  ["Message templates", "/app/templates"],
  ["Widgets", "/app/widgets"],
  ["Discounts", "/app/widgets/discounts"],
  ["Analytics", "/app/analytics"],
  ["Settings", "/app/settings"],
  ["Plan", "/app/settings/plan"],
];

const shotName = (path) => path.replace(/\//g, "_").replace(/^_/, "") || "app";
async function shoot(page, name) {
  if (await page.locator("s-page").count()) await page.locator("#ab-titlebar").waitFor({ timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  await page.screenshot({ path: `${SHOTS}/${name}.jpg`, type: "jpeg", quality: 45, fullPage: true }); // small copy for review
}

test("every page opens without errors; no second menu inside the app", async () => {
  const page = await newPage();
  for (const [label, path] of PAGES) {
    await page.goto(app.adminUrl(path), { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const heading = (await page.locator("s-page").first().getAttribute("heading").catch(() => null)) || "(no heading)";
    assert.ok(await page.evaluate(() => Boolean(customElements.get("s-page"))), `${label}: Polaris web components loaded`);
    console.log(`  ${label}: url=${new URL(page.url()).pathname} heading=${JSON.stringify(heading)}`);
    assert.equal(await page.locator(".wa-sidebar, .wa-sidebar__toggle").count(), 0, `${label}: no in-app sidebar`);
    const body = await page.locator("body").innerText();
    assert.doesNotMatch(body, /Application Error|Unexpected Server Error|Something went wrong/i, `${label} rendered`);
    if (label !== "Home") assert.match(heading, new RegExp(label === "Home" ? "." : label.split(" ")[0], "i"), `${label} heading`);
    await shoot(page, shotName(path));
  }
  // Sub-pages have a breadcrumb back to their menu item.
  await page.goto(app.adminUrl("/app/settings/plan"), { waitUntil: "networkidle" });
  await page.locator('#ab-titlebar [data-proxy="breadcrumb-actions"]').click();
  await page.waitForURL((u) => new URL(u).pathname === "/app/settings");
  assert.deepEqual(problems, [], "no page, hydration or console errors");
  await page.context().close();
});

test("Home: setup guide ticks the theme step from App Bridge, can be dismissed and brought back; Today links open the queues", async () => {
  const page = await newPage();
  await page.goto(app.adminUrl("/app"), { waitUntil: "networkidle" });
  const guide = page.locator("[data-setup-guide]");
  await guide.waitFor();
  // The stand-in reports the app embed as active: the step ticks itself.
  await page.locator('[data-step="embed"][data-done="1"]').waitFor({ timeout: 10000 });
  assert.ok((await prisma.shopSettings.findUnique({ where: { shop: SHOP } })).embedActiveAt, "embed status stored");
  assert.match(await guide.innerText(), /of 5 steps completed/);
  await shoot(page, "home-guide");

  // Turn on hold from the guide.
  await page.locator('[data-step="hold"] .wa-guide__title').click();
  await page.getByRole("button", { name: "Turn on hold" }).click();
  await page.locator('[data-step="hold"][data-done="1"]').waitFor();
  assert.equal((await prisma.shopSettings.findUnique({ where: { shop: SHOP } })).codHold, true);

  // Today → COD queue.
  await page.locator('[data-today="cod"] a').click();
  await page.waitForURL((u) => new URL(u).pathname === "/app/cod");
  await page.goBack();
  await page.waitForURL((u) => new URL(u).pathname === "/app");

  await page.locator("[data-dismiss-setup]").click();
  await guide.waitFor({ state: "detached" });
  assert.ok((await prisma.shopSettings.findUnique({ where: { shop: SHOP } })).setupDismissedAt, "dismissal saved per shop");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await guide.count(), 0, "stays dismissed");
  await page.getByRole("button", { name: "Show the setup guide" }).click();
  await guide.waitFor();
  await prisma.shopSettings.update({ where: { shop: SHOP }, data: { codHold: false } });
  assert.deepEqual(problems, []);
  await page.context().close();
});

test("COD queue: search, More tab menu, Send & next, row menu with a modal, order timeline", async () => {
  const page = await newPage();
  await page.goto(app.adminUrl("/app/cod"), { waitUntil: "networkidle" });
  const rows = page.locator("s-table-body s-table-row");
  const before = await rows.count();
  assert.ok(before >= 3, `COD list has rows (${before})`);

  // Search narrows the list and offers a way back.
  await page.locator(".wa-search__input").fill("zzz-no-such-order");
  await page.locator(".wa-empty", { hasText: "No matches" }).waitFor();
  await page.getByRole("button", { name: "Clear search" }).click();
  assert.equal(await rows.count(), before);

  // Tabs: three side by side, the rest under More, on one line.
  assert.equal(await page.locator(".wa-tabs > a.wa-tab").count(), 3);
  await page.locator(".wa-tabmore > summary").click();
  await page.getByRole("menuitem", { name: /Confirmed/ }).click();
  await page.waitForURL((u) => new URL(u).searchParams.get("filter") === "confirmed");
  await page.waitForLoadState("networkidle");
  assert.match(await page.locator(".wa-tabmore > summary").innerText(), /Confirmed/, "active More tab shows its name");
  await page.locator(".wa-tabs").getByRole("link", { name: /^To send/ }).click();
  await page.waitForURL((u) => new URL(u).searchParams.get("filter") === "todo");
  await page.waitForLoadState("networkidle");

  // Send & next: one primary button opens WhatsApp for the oldest order and records it.
  const next = page.locator("a[data-send-next]");
  const firstId = await next.getAttribute("data-send-next");
  const [popup] = await Promise.all([page.waitForEvent("popup"), next.click()]);
  await popup.close();
  await page.locator("[data-run-progress]").waitFor();
  assert.match(await page.locator("[data-run-progress]").innerText(), /1 sent in this run/);
  for (let i = 0; i < 20 && !(await prisma.order.findUnique({ where: { id: firstId } })).codSentAt; i++) await page.waitForTimeout(250);
  assert.ok((await prisma.order.findUnique({ where: { id: firstId } })).codSentAt, "first order marked sent");
  await page.waitForLoadState("networkidle");
  const secondId = await page.locator("a[data-send-next]").getAttribute("data-send-next");
  assert.notEqual(secondId, firstId, "moves on to the next order");
  await shoot(page, "cod-send-next");

  // Keyboard: J selects a row.
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("j");
  await page.locator("s-table-row.is-selected").waitFor();

  // Row menu → Mark cancelled asks in a modal; Cancel keeps the order, confirming cancels it.
  const row = page.locator(`s-table-row[data-row="${secondId}"]`);
  const menuItem = async (name) => {
    const menu = page.locator(".wa-menu--floating");
    if (!(await menu.isVisible().catch(() => false))) await row.locator("[data-rowmenu]").click();
    return menu.getByRole("button", { name });
  };
  await (await menuItem("Mark cancelled")).click();
  const modal = page.locator("dialog[open]");
  await modal.waitFor();
  assert.match(await modal.innerText(), /cancelled by the customer/);
  await shoot(page, "cod-modal");
  await modal.getByRole("button", { name: "Cancel" }).first().click();
  await modal.waitFor({ state: "detached" }).catch(() => {});
  assert.equal(await page.locator("dialog[open]").count(), 0, "modal closed");
  assert.equal((await prisma.order.findUnique({ where: { id: secondId } })).codStatus, "pending", "nothing changed");
  await (await menuItem("Mark cancelled")).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Mark cancelled" }).click();
  for (let i = 0; i < 20 && (await prisma.order.findUnique({ where: { id: secondId } })).codStatus !== "cancelled"; i++) await page.waitForTimeout(250);
  assert.equal((await prisma.order.findUnique({ where: { id: secondId } })).codStatus, "cancelled");
  await page.waitForLoadState("networkidle");

  // Bulk: select the remaining order and mark it confirmed.
  const pick = page.locator("[data-pick]").first();
  const pickedId = await pick.getAttribute("data-pick");
  await pick.check();
  await page.locator("[data-bulkbar]").waitFor();
  await shoot(page, "cod-bulk");
  await page.locator("[data-bulkbar]").getByRole("button", { name: "Mark confirmed" }).click();
  for (let i = 0; i < 20 && (await prisma.order.findUnique({ where: { id: pickedId } })).codStatus !== "confirmed"; i++) await page.waitForTimeout(250);
  assert.equal((await prisma.order.findUnique({ where: { id: pickedId } })).codStatus, "confirmed", "bulk mark confirmed");

  // Order timeline.
  await page.goto(app.adminUrl(`/app/cod/${firstId}`), { waitUntil: "networkidle" });
  const events = await page.locator("[data-timeline] [data-event]").evaluateAll((els) => els.map((e) => e.dataset.event));
  assert.deepEqual(events.slice(0, 1), ["created"]);
  assert.ok(events.includes("sent"), `timeline shows the send (${events})`);
  assert.ok(await page.locator("s-button[data-open-shopify]").count(), "Open in Shopify");
  await shoot(page, "cod-timeline");
  await page.locator('#ab-titlebar [data-proxy="breadcrumb-actions"]').click();
  await page.waitForURL((u) => new URL(u).pathname === "/app/cod");
  assert.deepEqual(problems, []);
  await page.context().close();
});

test("Settings: save bar appears on change, guards leaving, saves, and keeps fields from other tabs", async () => {
  const page = await newPage();
  await page.goto(app.adminUrl("/app/settings"), { waitUntil: "networkidle" });
  const before = await prisma.shopSettings.findUnique({ where: { shop: SHOP } });
  const bar = page.locator('ui-save-bar[data-open="true"]');
  assert.equal(await bar.count(), 0, "no save bar before changes");
  await page.getByRole("tab", { name: "COD rules" }).click();
  assert.match(page.url(), /tab=cod/);
  await page.locator('input[name="confirmedTag"]').fill("ui-confirmed");
  await bar.waitFor();
  assert.deepEqual(await page.evaluate(() => window.__saveBar), { id: "settings-save-bar", open: true }, "App Bridge save bar shown");
  await shoot(page, "settings-save-bar");

  // Leaving through an in-app link asks first.
  await page.locator(".wa-tabs").getByRole("link", { name: /Plan/ }).click();
  const modal = page.locator("dialog[open]");
  await modal.waitFor();
  assert.match(await modal.innerText(), /unsaved changes/i);
  await modal.getByRole("button", { name: "Stay" }).click();
  assert.equal(new URL(page.url()).pathname, "/app/settings", "stayed on Settings");

  await bar.getByRole("button", { name: "Save" }).click();
  for (let i = 0; i < 20; i++) {
    if ((await prisma.shopSettings.findUnique({ where: { shop: SHOP } }))?.confirmedTag === "ui-confirmed") break;
    await page.waitForTimeout(250);
  }
  const saved = await prisma.shopSettings.findUnique({ where: { shop: SHOP } });
  assert.equal(saved.confirmedTag, "ui-confirmed");
  assert.equal(saved.storeName, before.storeName, "fields on the other tab kept");
  assert.equal(saved.abandonDelayMin, before.abandonDelayMin);
  await page.waitForLoadState("networkidle");
  await bar.waitFor({ state: "detached" }).catch(() => {});
  assert.equal(await page.locator('ui-save-bar[data-open="true"]').count(), 0, "save bar gone after saving");
  assert.ok((await page.evaluate(() => window.__toasts || [])).includes("Settings saved"), "toast");

  // Store details, and Discard puts the form back.
  await page.getByRole("tab", { name: "Store & WhatsApp" }).click();
  await page.locator('input[name="storeName"]').fill("Golibar Browser");
  await page.locator('input[name="whatsappNumber"]').fill("98765 43210");
  await bar.getByRole("button", { name: "Save" }).click();
  for (let i = 0; i < 20 && (await prisma.shopSettings.findUnique({ where: { shop: SHOP } }))?.storeName !== "Golibar Browser"; i++) await page.waitForTimeout(250);
  const s = await prisma.shopSettings.findUnique({ where: { shop: SHOP } });
  assert.equal(s.storeName, "Golibar Browser");
  assert.equal(s.whatsappNumber, "919876543210");
  await page.waitForLoadState("networkidle");
  await page.locator('input[name="storeName"]').fill("Something else");
  await bar.waitFor();
  await bar.getByRole("button", { name: "Discard" }).click();
  assert.equal(await page.locator('input[name="storeName"]').inputValue(), "Golibar Browser", "discarded");
  assert.deepEqual(problems, [], "no errors while saving");
  await page.context().close();
});

test("Widgets, templates and discounts use the save bar; editors are pages with a breadcrumb", async () => {
  const page = await newPage();
  await page.goto(app.adminUrl("/app/widgets"), { waitUntil: "networkidle" });
  await page.locator(".wa-toggle", { hasText: "Pulse animation" }).click();
  const bar = page.locator('ui-save-bar[data-open="true"]');
  await bar.waitFor();
  await bar.getByRole("button", { name: "Save" }).click();
  await bar.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  assert.equal(await page.locator('ui-save-bar[data-open="true"]').count(), 0, "widgets saved");

  await page.goto(app.adminUrl("/app/templates"), { waitUntil: "networkidle" });
  await page.locator(".wa-tpl-row").first().click();
  await page.waitForURL((u) => /^\/app\/templates\/[a-f0-9]{24}$/.test(new URL(u).pathname));
  await page.waitForLoadState("networkidle");
  assert.match(await page.locator('s-link[slot="breadcrumb-actions"]').innerText(), /Message templates/, "breadcrumb back to the list");
  await page.locator("textarea").fill("Hi {name}, please confirm {order_no}: {confirm_link}");
  await bar.waitFor();
  await shoot(page, "template-editor");
  await bar.getByRole("button", { name: "Discard" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.locator("dialog[open]").waitFor();
  await page.locator("dialog[open]").getByRole("button", { name: "Cancel" }).click();

  await page.goto(app.adminUrl("/app/widgets/discounts"), { waitUntil: "networkidle" });
  await page.locator('#ab-titlebar [data-proxy="primary-action"]').click();
  await page.waitForURL((u) => new URL(u).pathname === "/app/widgets/discounts/new");
  await page.waitForLoadState("networkidle");
  await page.locator('input[name="code"]').fill("BROWSER15");
  await page.locator('input[name="value"]').fill("15");
  await bar.waitFor();
  await bar.getByRole("button", { name: "Save" }).click();
  await page.waitForURL((u) => new URL(u).pathname === "/app/widgets/discounts", { timeout: 15000 });
  await page.waitForLoadState("networkidle");
  assert.ok(await prisma.discount.findFirst({ where: { shop: SHOP, code: "BROWSER15" } }), "discount created");
  await shoot(page, "discounts");
  assert.deepEqual(problems, []);
  await page.context().close();
});

test("on a phone: no menu button, tabs on one line, Send & next within thumb reach, no sideways scroll", async () => {
  const page = await newPage({ mobile: true });
  await page.goto(app.adminUrl("/app"), { waitUntil: "networkidle" });
  assert.equal(await page.locator(".wa-sidebar__toggle").count(), 0, "no in-app menu button");
  await shoot(page, "mobile-home");
  await page.goto(app.adminUrl("/app/cod"), { waitUntil: "networkidle" });
  const tabs = await page.locator(".wa-tabs").boundingBox();
  assert.ok(tabs.height < 60, `tabs stay on one line (${tabs.height}px)`);
  const send = page.locator("a[data-send-next]");
  if (await send.count()) {
    const box = await send.boundingBox();
    assert.ok(box.y + box.height > 844 - 80, `Send & next at the bottom (${box.y})`);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `no horizontal scrolling (${overflow}px)`);
  await shoot(page, "mobile-cod");
  assert.deepEqual(problems, []);
  await page.context().close();
});

test("customer confirm page (phone): store name, trust lines, address; Cancel asks first; Confirm tags the order", async () => {
  const order = await prisma.order.findFirst({ where: { shop: SHOP, isCod: true, codStatus: { in: ["pending", "sent"] } }, orderBy: { createdAt: "asc" } });
  const page = await newPage({ mobile: true });
  await page.goto(`${app.BASE}/c/${order.confirmToken}`, { waitUntil: "networkidle" });
  const text = await page.locator("main").innerText();
  assert.match(text, /pay the courier in cash/i);
  assert.match(text, /never ask for an OTP/i);
  assert.match(text, /Sunrise Apartments/, "delivery address shown on Free");
  await shoot(page, "confirm-before");
  await page.locator('button[value="cancelled"]').click();
  await page.locator(".cf__sheet").waitFor();
  await shoot(page, "confirm-cancel-sheet");
  await page.getByRole("button", { name: "No, keep my order" }).click();
  assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).codStatus, order.codStatus, "not cancelled");
  await page.locator('button[value="confirmed"]').click();
  await page.locator(".cf__result").waitFor();
  await shoot(page, "confirm-after");
  // The page shows the result as soon as the tap is sent; Shopify is called while the request finishes.
  await page.waitForLoadState("networkidle");
  for (let i = 0; i < 40 && !app.shopify.calls.some((c) => c.op === "tagOrder"); i++) await page.waitForTimeout(250);
  assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).codStatus, "confirmed");
  assert.ok(app.shopify.calls.some((c) => c.op === "tagOrder"), "order tagged in Shopify");

  // "Send a test to yourself" opens a sample of the same page that changes nothing.
  await page.goto(`${app.BASE}/c/sample?shop=${SHOP}`, { waitUntil: "networkidle" });
  assert.match(await page.locator("main").innerText(), /sample order/i);
  await page.locator('button[value="confirmed"]').click();
  await page.locator(".cf__result").waitFor();
  assert.deepEqual(problems, []);
  await page.context().close();
});
