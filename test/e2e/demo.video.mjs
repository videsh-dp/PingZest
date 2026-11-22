/**
 * Demo videos of the Free and the Pro plan, recorded in Chromium against the same fake Shopify as the
 * browser e2e (test/e2e/harness.mjs). A caption bar explains each step, a visible cursor moves to what is
 * clicked, and the target gets an outline first. Pages that fail, error or render empty fail the run.
 *
 *   npm run demo:video            (after npm run build; same CI setup as test:e2e:browser; needs ffmpeg)
 *
 * Writes test/e2e/demo/pingzest-free.mp4 and pingzest-pro.mp4 (1280x720, H.264).
 * The customer's confirm page is recorded at phone size and placed in the middle of the frame.
 */
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { SHOP, SECRET, UA, prisma, sessionToken, codOrder, startApp } from "./harness.mjs";

const OUT = process.env.DEMO_OUT || "test/e2e/demo";
const RAW = join(OUT, "raw");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(RAW, { recursive: true });

const SPEED = Number(process.env.DEMO_SPEED || 1); // 0.2 for a quick dry run
const W = 1280, H = 720;
const PHONE = { width: 390, height: 780 };
const HOUR = 3600e3, DAY = 24 * HOUR;

let app, browser;
const problems = [];
const ignorable = (t) => /cdn\.shopify\.com|favicon|net::ERR_FAILED|ERR_BLOCKED_BY_CLIENT|ERR_ABORTED|Failed to load resource|wa\.me|whatsapp\.com|pay\.demo/i.test(t);
let billingRedirect = null;

/* ---------------- recording helpers ---------------- */

const OVERLAY_CSS = `
#__demo_cap{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);width:min(1060px,calc(100% - 28px));box-sizing:border-box;
  background:rgba(15,23,42,.94);color:#fff;border-radius:14px;padding:14px 22px 15px;z-index:2147483646;pointer-events:none;
  font:400 19px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);border-left:6px solid #25d366}
#__demo_cap b{display:block;font-size:23px;font-weight:700;margin-bottom:3px;letter-spacing:.1px}
#__demo_cap i{font-style:normal;float:right;font-size:14px;font-weight:600;color:#25d366;margin-top:5px}
@media (max-width:600px){#__demo_cap{bottom:10px;padding:10px 13px;font-size:14px;border-radius:11px}#__demo_cap b{font-size:16px}#__demo_cap i{display:none}}
#__demo_cur{position:fixed;left:0;top:0;width:26px;height:26px;margin:-4px 0 0 -4px;z-index:2147483647;pointer-events:none;transition:transform .08s}
#__demo_cur.down{transform:scale(.8)}
body{padding-bottom:120px!important}
`;
const CURSOR_SVG = `<svg width="26" height="26" viewBox="0 0 26 26"><path d="M4 2 L4 21 L9 16.5 L12.5 24 L16 22.5 L12.6 15.2 L19.5 15.2 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

function recorder(label) {
  const segments = [];
  let mouse = { x: W / 2, y: H / 2 };
  let tag = label;

  async function ensureOverlay(page) {
    await page.evaluate(([css, svg, m]) => {
      if (!document.getElementById("__demo_style")) {
        const s = document.createElement("style");
        s.id = "__demo_style";
        s.textContent = css;
        document.head.appendChild(s);
      }
      if (!document.getElementById("__demo_cur")) {
        const c = document.createElement("div");
        c.id = "__demo_cur";
        c.innerHTML = svg;
        c.style.left = `${m.x}px`;
        c.style.top = `${m.y}px`;
        document.body.appendChild(c);
        addEventListener("mousemove", (e) => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
        addEventListener("mousedown", () => c.classList.add("down"), true);
        addEventListener("mouseup", () => c.classList.remove("down"), true);
      }
    }, [OVERLAY_CSS, CURSOR_SVG, mouse]).catch(() => {});
  }

  /** Caption bar: a short title and one sentence. */
  async function caption(page, title, text) {
    await page.waitForLoadState("networkidle").catch(() => {});
    await ensureOverlay(page);
    await page.evaluate(([title, text, tag]) => {
      let el = document.getElementById("__demo_cap");
      if (!el) { el = document.createElement("div"); el.id = "__demo_cap"; document.body.appendChild(el); }
      el.innerHTML = "<i></i><b></b><span></span>";
      el.querySelector("i").textContent = tag;
      el.querySelector("b").textContent = title;
      el.querySelector("span").textContent = text;
    }, [title, text, tag]);
    console.log(`  [${label}] ${title}: ${text}`);
  }

  const beat = (page, ms = 2600) => page.waitForTimeout(Math.round(ms * SPEED));

  async function moveTo(page, x, y) {
    await ensureOverlay(page);
    await page.mouse.move(x, y, { steps: Math.max(4, Math.round(22 * Math.min(1, SPEED * 2))) });
    mouse = { x, y };
  }

  async function outline(locator, on) {
    await locator.evaluate((el, on) => {
      if (on) { el.dataset.demoOutline = el.style.outline || ""; el.style.outline = "3px solid #f59e0b"; el.style.outlineOffset = "3px"; el.style.borderRadius ||= "6px"; }
      else { el.style.outline = el.dataset.demoOutline || ""; el.style.outlineOffset = ""; }
    }, on).catch(() => {});
  }

  /** Point at an element (outline + cursor) and leave it highlighted for a moment. */
  async function point(page, locator, ms = 1600) {
    await locator.first().scrollIntoViewIfNeeded().catch(() => {});
    const box = await locator.first().boundingBox();
    if (!box) throw new Error(`[${label}] nothing to point at: ${locator}`);
    await outline(locator.first(), true);
    await moveTo(page, box.x + Math.min(box.width / 2, 60), box.y + box.height / 2);
    await beat(page, ms);
    await outline(locator.first(), false);
  }

  async function click(page, locator, ms = 900) {
    await point(page, locator, ms);
    await locator.first().click();
  }

  async function scroll(page, dy, steps = 6) {
    for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await page.waitForTimeout(90); }
    await beat(page, 600);
  }

  async function nav(page, linkName, path) {
    await click(page, page.locator(".wa-sidebar").getByRole("link", { name: new RegExp(`^${linkName}`) }));
    await page.waitForURL((u) => new URL(u).pathname === path, { timeout: 15000 });
    await page.waitForLoadState("networkidle");
    await checkPage(page, linkName);
  }

  /** One recorded piece (a browser context). Phone pieces are padded into the 1280x720 frame later. */
  async function segment(name, { phone = false } = {}, fn) {
    const size = phone ? PHONE : { width: W, height: H };
    const context = await newContext({ viewport: size, recordVideo: { dir: RAW, size } });
    const page = await context.newPage();
    watch(page);
    context.on("page", (p) => setTimeout(() => p.close().catch(() => {}), 300)); // WhatsApp tabs
    try {
      await fn(page);
      await beat(page, 800);
    } finally {
      const video = page.video();
      await context.close();
      const path = await video.path();
      segments.push({ name, path, phone });
    }
    return page;
  }

  return { segments, caption, beat, point, click, scroll, nav, segment, moveTo, setTag: (t) => { tag = t; } };
}

async function newContext(opts) {
  const context = await browser.newContext({ userAgent: UA, deviceScaleFactor: 1, acceptDownloads: true, ...opts });
  await context.exposeFunction("__e2eToken", () => sessionToken({ ttl: 600 }));
  await context.exposeFunction("__demoRedirect", (url) => { billingRedirect = url; });
  // Stand-in for App Bridge (as in browser.test.mjs), plus its "leave the iframe" redirect for billing.
  await context.addInitScript(() => {
    window.shopify = {
      idToken: () => window.__e2eToken(), config: {}, environment: { embedded: true },
      toast: { show: (m) => console.log(`[toast] ${m}`) }, loading: () => {}, saveBar: { show() {}, hide() {} }, modal: { show() {}, hide() {} },
    };
    const original = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      if (url.origin === location.origin) {
        const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined));
        headers.set("Authorization", `Bearer ${await window.__e2eToken()}`);
        init = { ...init, headers };
      }
      const res = await original(input, init);
      const reauth = res.headers.get("X-Shopify-API-Request-Failure-Reauthorize-Url");
      if (reauth) { window.__demoRedirect(reauth); return new Promise(() => {}); }
      return res;
    };
  });
  await context.route("https://cdn.shopify.com/**", (route) => {
    const u = route.request().url();
    if (u.endsWith(".js")) return route.fulfill({ status: 200, contentType: "application/javascript", body: "/* stubbed */" });
    if (u.endsWith(".css")) return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    return route.abort();
  });
  // WhatsApp opens in a new tab in real life; here the tab is closed straight away.
  await context.route(/https:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//, (route) => route.abort());
  // Shopify's payment page for "pay online" (a neutral stand-in page).
  await context.route("https://pay.demo.local/**", (route) => route.fulfill({
    status: 200, contentType: "text/html",
    body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;margin:0;background:#f4f4f5">
      <div style="max-width:360px;margin:60px auto;background:#fff;border-radius:14px;padding:24px;text-align:center;box-shadow:0 2px 10px #0001">
      <div style="font-size:40px">💳</div><h2 style="margin:8px 0">Online payment</h2><p style="color:#555">Demo stand-in for the store's own Shopify payment page (UPI, cards, netbanking). The customer pays the discounted amount here.</p>
      <div style="background:#16a34a;color:#fff;border-radius:10px;padding:12px;margin-top:16px">Payment successful ✓</div></div></body>`,
  }));
  return context;
}

function watch(page) {
  page.on("pageerror", (e) => problems.push(`${page.url()} pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !ignorable(m.text())) problems.push(`${page.url()} console: ${m.text().slice(0, 300)}`); });
  page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(app.BASE)) problems.push(`${r.url()} HTTP ${r.status()}`); });
  page.on("dialog", (d) => d.accept());
}

async function checkPage(page, label) {
  const body = await page.locator("body").innerText();
  if (/Application Error|Unexpected Server Error|Something went wrong|404 Not Found/i.test(body)) problems.push(`${label}: error page shown`);
  if (body.trim().length < 80) problems.push(`${label}: page looks empty`);
}

async function waitDb(check, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return true; await new Promise((r) => setTimeout(r, 200)); }
  return false;
}

/* ---------------- demo data: "Golibar", an Indian ethnic-wear store ---------------- */

const orderRow = (o) => prisma.order.findFirst({ where: { shop: SHOP, shopifyOrderId: String(o.id) } });
const SETTINGS = { storeName: "Golibar", whatsappNumber: "98200 12345", countryCode: "91", defaultLang: "en", appLocale: "auto", confirmedTag: "cod-confirmed", cancelledTag: "cod-cancelled", abandonDelayMin: "30" };
const LOOP = { loopSettings: "1", codHold: "on", codRemindHours: "24", codExpireHours: "72", noReplyTag: "cod-no-reply", cancelRestock: "on", rtoCost: "450" };

function person(name, city, zip, phone, address1, item, price, extra = {}) {
  const [first, last] = name.split(" ");
  return codOrder({
    total_price: price, subtotal_price: price, phone, email: `${first.toLowerCase()}@example.in`,
    customer: { first_name: first, last_name: last, phone, orders_count: extra.orders_count ?? 1 },
    shipping_address: { first_name: first, last_name: last, address1, address2: extra.address2 || "", city, zip, country_code: "IN", phone },
    line_items: [{ title: item, quantity: 1, price }],
    ...extra.order,
  });
}

async function addOrder(o, { name, hoursAgo = 0, sentHoursAgo = null } = {}) {
  if (name) o.name = name;
  app.shopify.state.orders.set(o.admin_graphql_api_id, { total: o.total_price, subtotal: o.subtotal_price, outstanding: o.total_price, paymentUrl: `https://pay.demo.local/${o.id}` });
  await app.webhook("/webhooks/orders", "orders/create", o);
  const row = await orderRow(o);
  if (hoursAgo) await prisma.order.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - hoursAgo * HOUR) } });
  if (sentHoursAgo != null) {
    await app.act("/app/cod", { intent: "sent", id: row.id, templateId: "", templateName: "Standard", lang: "en" });
    await prisma.order.update({ where: { id: row.id }, data: { codSentAt: new Date(Date.now() - sentHoursAgo * HOUR) } });
  }
  return orderRow(o);
}

function proxyQuery() {
  const params = { shop: SHOP, logged_in_customer_id: "", path_prefix: "/apps/pingzest", timestamp: String(Math.floor(Date.now() / 1000)) };
  const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("");
  return new URLSearchParams({ ...params, signature: createHmac("sha256", SECRET).update(message).digest("hex") }).toString();
}

const D = {}; // demo orders by key

async function seed() {
  await app.page("/app"); // first open: token exchange, settings and standard templates
  await app.act("/app/settings", { ...SETTINGS, ...LOOP });
  await app.act("/app/widgets", { config: JSON.stringify({ chat: { enabled: true, agents: [{ name: "Golibar Support", phone: "919820012345" }], popup: { enabled: true, title: "Chat with Golibar", text: "Hi! Ask us about sizes, fabrics or your order." }, style: { label: "Chat with us" } } }) });

  // History for "Saved on returns", analytics and (later, on Pro) returns breakdowns.
  const history = [
    ["Kavya Reddy", "Hyderabad", "500001", "Chanderi Kurta", "1450.00", 26, "confirmed", { shipped: true }],
    ["Arjun Mehta", "Mumbai", "400001", "Linen Shirt", "1199.00", 22, "confirmed", { shipped: true, rto: true, coupon: "FEST20" }],
    ["Sneha Patil", "Pune", "411001", "Silk Dupatta", "999.00", 19, "cancelled", {}],
    ["Rohit Das", "Kolkata", "700001", "Cotton Kurta", "899.00", 17, "confirmed", { shipped: true }],
    ["Pooja Sharma", "Delhi", "110001", "Anarkali Set", "3299.00", 15, "no_reply", { hour: 1 }],
    ["Imran Khan", "Delhi", "110001", "Pathani Suit", "2499.00", 12, "confirmed", { shipped: true, rto: true, hour: 2, coupon: "FEST20" }],
    ["Divya Menon", "Kochi", "682001", "Kasavu Saree", "4199.00", 10, "cancelled", { coupon: "FEST20" }],
    ["Karan Malhotra", "Mumbai", "400001", "Nehru Jacket", "2199.00", 8, "confirmed", { shipped: true, repeat: true }],
    ["Lakshmi Iyer", "Chennai", "600001", "Cotton Saree", "1599.00", 6, "confirmed", { shipped: true, repeat: true }],
    ["Aman Gupta", "Delhi", "110001", "Kurta Pyjama", "1299.00", 5, "shipped_unconfirmed", { shipped: true, rto: true, hour: 23 }],
    ["Nisha Rao", "Bengaluru", "560001", "Ikat Dress", "1899.00", 4, "cancelled", {}],
    ["Farhan Ali", "Lucknow", "226001", "Chikan Kurta", "1749.00", 3, "confirmed", { shipped: true }],
  ];
  let n = 1001;
  for (const [name, city, zip, item, price, daysAgo, status, x] of history) {
    const phone = `+9198${String(10000000 + n * 7919).slice(0, 8)}`;
    const hour = x.hour ?? 11 + (n % 9);
    const placed = new Date(Date.now() - daysAgo * DAY);
    const created = `${placed.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:15:00+05:30`;
    const o = person(name, city, zip, phone, `${10 + n % 80}, Main Road`, item, price, { orders_count: x.repeat ? 4 : 1, order: { created_at: created, ...(x.coupon ? { discount_codes: [{ code: x.coupon }] } : {}) } });
    const row = await addOrder(o, { name: `#${n++}` });
    const data = { createdAt: placed };
    if (status !== "shipped_unconfirmed") {
      await app.act("/app/cod", { intent: "sent", id: row.id, templateId: "", templateName: "Standard", lang: "en" });
      data.codSentAt = new Date(placed.getTime() + 2 * HOUR);
      if (status === "no_reply") Object.assign(data, { codStatus: "no_reply", codExpiredAt: new Date(placed.getTime() + 74 * HOUR) });
      else Object.assign(data, { codStatus: status, codRespondedAt: new Date(placed.getTime() + 3 * HOUR), codRespondedBy: "customer" });
    }
    if (x.shipped) data.shippedAt = new Date(placed.getTime() + DAY);
    if (x.rto) data.rtoAt = new Date(placed.getTime() + 6 * DAY);
    if (x.shipped) Object.assign(data, { heldAt: null });
    await prisma.order.update({ where: { id: row.id }, data });
  }

  // Today's queue.
  D.priya = await addOrder(person("Priya Shah", "Pune", "411001", "+919812345678", "Flat 402, Sunrise Apartments, MG Road", "Blue Cotton Kurta", "1299.00", { address2: "Near City Mall" }), { name: "#1041", hoursAgo: 1 });
  D.rahul = await addOrder(person("Rahul Verma", "Lucknow", "226010", "+919839012345", "B-12, Gomti Nagar", "Chikankari Kurta Set", "2150.00"), { name: "#1042", hoursAgo: 13 });
  D.anjali = await addOrder(person("Anjali Nair", "Kochi", "682016", "+919847012345", "TC 14/220, MG Road", "Cotton Dupatta", "899.00"), { name: "#1043", hoursAgo: 31, sentHoursAgo: 30 });
  D.vikram = await addOrder(person("Vikram Singh", "Jaipur", "302001", "+919829012345", "45, Civil Lines", "Bandhani Saree", "3499.00"), { name: "#1044", hoursAgo: 81, sentHoursAgo: 80 });
  D.risky = await addOrder(person("Test User", "x", "000000", "+911111111111", "abc", "Banarasi Silk Saree (x3)", "24999.00", { orders_count: 0, order: { email: "test@test.com", line_items: [{ title: "Banarasi Silk Saree", quantity: 3, price: "8333.00" }] } }), { name: "#1045", hoursAgo: 2 });

  // Shipped (prepaid) order for Order updates.
  const meera = person("Meera Iyer", "Chennai", "600020", "+919884012345", "7, Besant Nagar 2nd Ave", "Kanjivaram Saree", "6499.00", { order: { payment_gateway_names: ["Razorpay"] } });
  meera.name = "#1040";
  await app.webhook("/webhooks/orders", "orders/create", meera);
  await app.webhook("/webhooks/fulfillments", "fulfillments/create", { id: 55001, order_id: meera.id, status: "success", tracking_url: "https://www.delhivery.com/track/package/1234567890", tracking_urls: ["https://www.delhivery.com/track/package/1234567890"], tracking_number: "1234567890", tracking_company: "Delhivery" });

  // Abandoned checkouts.
  for (const [id, first, phone, item, price] of [[7001, "Neha", "+919822222222", "Silk Saree", "2499.00"], [7002, "Arjun", "+919833333333", "Embroidered Juttis", "899.00"], [7003, "Sana", "+919844444444", "Lehenga Choli", "5999.00"]]) {
    const token = `demo-${id}-${Date.now()}`;
    await app.webhook("/webhooks/checkouts", "checkouts/create", {
      id, token, cart_token: token, abandoned_checkout_url: `https://${SHOP}/checkouts/${token}/recover`, phone, total_price: price, currency: "INR",
      customer: { first_name: first, phone }, line_items: [{ title: item, quantity: 1, price }],
    });
  }
  await prisma.checkout.updateMany({ where: { shop: SHOP }, data: { createdAt: new Date(Date.now() - 3 * HOUR), updatedAt: new Date(Date.now() - 3 * HOUR) } });

  // Four custom templates (the Free plan allows 5).
  for (const [name, type, body] of [
    ["Short & friendly", "cod_confirm", "Hi {name} 👋 Please confirm your {store} order {order_no} ({total}): {confirm_link}"],
    ["Festive", "cod_confirm", "🪔 Hi {name}, thank you for shopping with {store}! Tap to confirm order {order_no}: {confirm_link}"],
    ["Hinglish", "cod_confirm", "Namaste {name}! Aapka order {order_no} confirm karne ke liye yahan tap karein: {confirm_link}"],
    ["Cart nudge", "abandoned_cart", "Hi {name}, you left something at {store}. Complete your order here: {checkout_link}"],
  ]) await app.act("/app/templates", { intent: "create", type, lang: "en", name, body });

  // Widget views and clicks from the storefront.
  for (let i = 0; i < 6; i++) {
    const events = [{ widget: "chat", event: "view" }, { widget: "chat", event: i % 2 ? "click" : "view" }, { widget: "product", event: "click" }, { widget: "discount", event: "view" }];
    await fetch(`${app.BASE}/proxy/track?${proxyQuery()}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ pageType: i % 2 ? "product" : "index", device: i % 3 ? "mobile" : "desktop", events }) });
  }
}

/* ---------------- FREE plan video ---------------- */

async function freeVideo() {
  const r = recorder("free");
  r.setTag("PingZest · Free plan");

  await r.segment("free-admin-1", {}, async (page) => {
    await page.goto(app.adminUrl("/app"), { waitUntil: "networkidle" });
    await checkPage(page, "Home");
    await r.caption(page, "PingZest inside Shopify admin", "Golibar, an Indian ethnic-wear store, is on the Free plan. Home shows what needs attention first.");
    await r.beat(page, 3200);
    await r.point(page, page.locator(".wa-alerts").first(), 2200);
    await r.caption(page, "Alerts for stuck work", "COD orders not sent for 12 hours, customers past the reminder or expiry time: nothing slips through.");
    await r.beat(page, 2600);
    await r.scroll(page, 380);
    await r.caption(page, "Saved on returns", "Every COD order cancelled before shipping is a parcel you didn't pay to send and get back, shown in rupees.");
    await r.point(page, page.getByText("Saved on returns").first(), 2600);
    await r.scroll(page, 420);
    await r.caption(page, "Setup checklist", "A few one-time steps: WhatsApp number, chat button, theme embed, templates.");
    await r.beat(page, 2800);
    await r.scroll(page, -1200);

    await r.caption(page, "Everything in one sidebar", "Grouped by what you're doing: Overview, Orders, Storefront, Messages and Account. Badges count work waiting.");
    for (const t of ["Overview", "Orders", "Storefront", "Messages", "Account"]) {
      await r.point(page, page.locator(".wa-sidebar").getByText(t, { exact: true }), 700);
    }

    // Settings
    await r.nav(page, "Settings", "/app/settings");
    await r.caption(page, "Settings → General", "Store name and WhatsApp number used in every message, default country code and message language.");
    await r.point(page, page.locator('input[name="storeName"]'), 1500);
    await r.point(page, page.locator('input[name="whatsappNumber"]'), 1500);
    await r.click(page, page.getByRole("tab", { name: "Orders" }));
    await r.caption(page, "Settings → Orders", "Tags added in Shopify when a customer confirms, cancels or doesn't reply.");
    await r.point(page, page.locator('input[name="confirmedTag"]'), 1400);
    await r.point(page, page.locator('input[name="noReplyTag"]'), 1200);
    await r.caption(page, "Hold fulfillment until confirmed", "New COD orders are put on hold in Shopify so nobody ships them by mistake. Released when the customer confirms.");
    await r.point(page, page.locator('input[name="codHold"]').locator(".."), 2600);
    await r.point(page, page.locator('input[name="codRemindHours"]'), 1200);
    await r.point(page, page.locator('input[name="codExpireHours"]'), 1600);
    await r.click(page, page.getByRole("tab", { name: /COD money-savers/ }));
    await r.caption(page, "COD money-savers are Pro", "Risk score, pay-online offer and address check unlock with Pro. We'll see them in the Pro video.");
    await r.beat(page, 2600);

    // Widgets
    await r.nav(page, "Widgets", "/app/widgets");
    await r.caption(page, "Widgets editor with a live preview", "Design the WhatsApp chat button, discount banner and page buttons. The preview runs the real storefront script.");
    await r.beat(page, 2600);
    const frame = page.frameLocator(".wa-preview-frame");
    await r.click(page, frame.locator(".wa-chat__bubble"));
    await r.caption(page, "Try it in the preview", "Shoppers tap the button, pick an agent and land in WhatsApp with a message ready. Free shows “Powered by PingZest”.");
    await r.point(page, frame.locator(".wa-chat__brand"), 2600);
    await r.click(page, page.locator(".wa-seg").getByRole("button", { name: "Mobile" }));
    await r.caption(page, "Desktop and mobile", "Placement, size and icon-only mode are set per device; page rules choose where each widget shows.");
    await r.beat(page, 2600);

    // COD queue
    await r.nav(page, "COD confirmation", "/app/cod");
    await r.caption(page, "COD confirmation queue", "New Cash on Delivery orders arrive here by webhook. Tabs: To send, Waiting, To remind, Confirmed, Cancelled, No reply.");
    await r.beat(page, 3000);
    const priyaRow = page.locator("tr", { hasText: "#1041" });
    await r.click(page, priyaRow.getByRole("button", { name: "Preview message" }));
    await r.caption(page, "The message, ready to send", "Personalised with the customer's name, order and a confirm link. You can preview it before opening WhatsApp.");
    await r.beat(page, 2800);
    await r.caption(page, "Send with: template and language", "Pick one of your templates and the customer's language; every message in the list updates instantly.");
    await r.point(page, page.locator(".wa-sendwith select").first(), 1600);
    await page.locator(".wa-sendwith select").first().selectOption({ label: "Short & friendly" });
    await page.waitForLoadState("networkidle");
    await r.beat(page, 1500);
    await r.point(page, page.locator(".wa-sendwith select").nth(1), 1400);
    await r.caption(page, "Send on WhatsApp", "One click opens WhatsApp with the message typed in. You press send from your own WhatsApp: no Meta API, no per-message fees.");
    await r.click(page, page.locator("tr", { hasText: "#1041" }).getByRole("link", { name: "Send on WhatsApp" }), 1600);
    await waitDb(async () => (await prisma.order.findUnique({ where: { id: D.priya.id } }))?.codSentAt);
    await r.beat(page, 1800);
  });

  // The customer on their phone.
  await r.segment("free-phone", { phone: true }, async (page) => {
    const row = await prisma.order.findUnique({ where: { id: D.priya.id } });
    await page.goto(`${app.BASE}/c/${row.confirmToken}?l=en`, { waitUntil: "networkidle" });
    await checkPage(page, "confirm page");
    await r.caption(page, "The customer's phone", "Priya taps the link in WhatsApp and sees her order, in her language. No login.");
    await r.beat(page, 3200);
    await r.click(page, page.locator('button[value="confirmed"]'), 1400);
    await page.locator(".cf__result").waitFor();
    await r.caption(page, "Confirmed in one tap", "The order is tagged in Shopify and the fulfillment hold is released, so it can ship.");
    await r.beat(page, 3000);
  });

  await r.segment("free-admin-2", {}, async (page) => {
    await page.goto(app.adminUrl("/app/cod", { filter: "confirmed" }), { waitUntil: "networkidle" });
    await checkPage(page, "COD confirmed");
    await r.caption(page, "Back in the app: Confirmed", "Priya's order moved to Confirmed by the customer, with the confirmed tag in Shopify.");
    await r.point(page, page.locator("tr", { hasText: "#1041" }).first(), 2800);

    await r.click(page, page.locator(".wa-tabs").getByRole("link", { name: /^To remind/ }));
    await page.waitForLoadState("networkidle");
    await r.caption(page, "To remind", "Customers who haven't answered after 24 hours. Send reminder opens WhatsApp with the reminder template.");
    await r.point(page, page.locator("tr", { hasText: "#1043" }).getByRole("link", { name: "Send reminder" }), 2600);
    await page.locator("tr", { hasText: "#1043" }).getByRole("link", { name: "Send reminder" }).click();
    await waitDb(async () => (await prisma.order.findUnique({ where: { id: D.anjali.id } }))?.codRemindedAt);
    await r.beat(page, 1200);

    await r.click(page, page.locator(".wa-tabs").getByRole("link", { name: /^Waiting for reply/ }));
    await page.waitForLoadState("networkidle");
    await r.caption(page, "Expire now", "Vikram hasn't replied in 80 hours, past the 72-hour expiry. Expire now moves it to No reply and adds the no-reply tag.");
    await r.click(page, page.locator("tr", { hasText: "#1044" }).getByRole("button", { name: "Expire now" }), 1800);
    await waitDb(async () => (await prisma.order.findUnique({ where: { id: D.vikram.id } }))?.codStatus === "no_reply");

    await r.click(page, page.locator(".wa-tabs").getByRole("link", { name: /^No reply/ }));
    await page.waitForLoadState("networkidle");
    await r.caption(page, "Cancel in Shopify", "One click cancels the unanswered order in Shopify and puts the items back in stock. The customer isn't emailed.");
    await r.click(page, page.locator("tr", { hasText: "#1044" }).getByRole("button", { name: "Cancel in Shopify" }), 1800);
    await waitDb(async () => (await prisma.order.findUnique({ where: { id: D.vikram.id } }))?.shopifyCancelledAt);
    await page.waitForLoadState("networkidle");
    await r.point(page, page.locator("tr", { hasText: "#1044" }).getByText("Cancelled in Shopify"), 2400);

    // Abandoned checkouts
    await r.nav(page, "Abandoned checkouts", "/app/carts");
    await r.caption(page, "Abandoned checkouts", "Shoppers who entered a phone number but didn't finish. Send a reminder with their checkout link.");
    await r.beat(page, 2400);
    await r.click(page, page.locator("tr", { hasText: "Neha" }).getByRole("link", { name: /Send/ }), 1400);
    await r.beat(page, 1200);
    await r.caption(page, "Dismiss what you won't send", "Not every checkout needs a message. Dismissed ones move to their own tab.");
    await r.click(page, page.locator("tr", { hasText: "Arjun" }).getByRole("button", { name: "Dismiss" }), 1400);
    await page.waitForLoadState("networkidle");
    await r.click(page, page.locator(".wa-tabs").getByRole("link", { name: /^Dismissed/ }));
    await page.waitForLoadState("networkidle");
    await r.caption(page, "Dismissed → Restore", "Changed your mind? Restore puts the checkout back in To send.");
    await r.click(page, page.locator("tr", { hasText: "Arjun" }).getByRole("button", { name: "Restore" }), 1600);
    await page.waitForLoadState("networkidle");
    await r.beat(page, 1200);

    // Order updates
    await r.nav(page, "Order updates", "/app/updates");
    await r.caption(page, "Order updates", "Shipped and delivered orders from Shopify, with tracking links. Send the update on WhatsApp in a click.");
    await r.point(page, page.locator("tr", { hasText: "#1040" }).first(), 2800);

    // Templates
    await r.nav(page, "Message templates", "/app/templates");
    await r.caption(page, "Message templates", "Standard messages in 7 languages for every stage, plus your own. WhatsApp formatting, emoji and variables.");
    await r.beat(page, 2600);
    await r.point(page, page.getByText(/Custom templates: 4 of 5/), 2000);
    await r.click(page, page.locator("summary", { hasText: "+ New template" }));
    await r.click(page, page.getByRole("button", { name: "Copy of the standard message" }));
    const nameInput = page.getByPlaceholder("e.g. Short & friendly");
    await r.point(page, nameInput, 600);
    await nameInput.fill("");
    await nameInput.pressSequentially("Weekend sale", { delay: 60 });
    await r.caption(page, "Create a template", "The phone-style preview shows exactly how WhatsApp will render it.");
    await r.click(page, page.getByRole("button", { name: "Create template" }), 1200);
    await waitDb(async () => (await prisma.messageTemplate.count({ where: { shop: SHOP, seeded: false } })) >= 5);
    await page.waitForLoadState("networkidle");
    await page.getByText(/You've used all 5 custom templates/).waitFor({ timeout: 10000 });
    await r.caption(page, "Free plan: 5 custom templates", "That was the fifth. To add more, delete one or upgrade to Pro for unlimited templates.");
    await r.point(page, page.getByText(/You've used all 5 custom templates/), 3000);

    // Analytics
    await r.nav(page, "Analytics", "/app/analytics");
    await r.caption(page, "Message analytics", "Messages sent per day and stage, COD confirm and cancel rates, reply time, checkout recovery and template performance.");
    await r.beat(page, 2800);
    await r.scroll(page, 500);
    await r.scroll(page, -500);
    await r.click(page, page.locator(".wa-tabs").getByRole("link", { name: /^Returns/ }));
    await page.waitForLoadState("networkidle");
    await r.caption(page, "Analytics → Returns", "Free shows what confirmations saved you. The breakdowns by PIN code, first order, coupon and hour are Pro.");
    await r.beat(page, 2400);
    await r.point(page, page.getByText(/Returns insights are on Pro/), 2800);

    // Plan
    await r.nav(page, "Plan", "/app/plan");
    await r.caption(page, "Plan: Free vs Pro", "Free stays free. Pro is a flat price billed by Shopify, no per-message fees, with a 7-day free trial.");
    await r.beat(page, 2600);
    await r.scroll(page, 400);
    await r.point(page, page.getByRole("button", { name: /Start 7-day free trial/ }), 3000);
  });
  return r.segments;
}

/* ---------------- PRO plan video ---------------- */

async function proVideo() {
  const r = recorder("pro");
  r.setTag("PingZest · Pro plan");

  await r.segment("pro-admin-1", {}, async (page) => {
    await page.goto(app.adminUrl("/app/plan"), { waitUntil: "networkidle" });
    await checkPage(page, "Plan (free)");
    await r.caption(page, "Upgrade to Pro", "Golibar starts the 7-day free trial. Shopify bills it on the store's Shopify invoice.");
    await r.scroll(page, 400);
    billingRedirect = null;
    await r.click(page, page.getByRole("button", { name: /Start 7-day free trial/ }), 1600);
    const sawRedirect = await waitDb(async () => Boolean(billingRedirect), 10000);
    if (!sawRedirect) problems.push("upgrade: no App Bridge redirect to Shopify's approval page");
    console.log(`  [pro] approval URL from the app: ${billingRedirect}`);
    await r.caption(page, "Shopify's approval page", "Here Shopify shows its own charge approval screen (not part of this demo). The merchant approves the trial.");
    await r.beat(page, 3000);
    // What Shopify does after approval: the subscription becomes active and the webhook arrives.
    app.shopify.state.subscription = { ...app.shopify.state.pending, status: "ACTIVE" };
    await app.webhook("/webhooks/app/subscriptions_update", "app_subscriptions/update", {
      app_subscription: { admin_graphql_api_id: app.shopify.state.subscription.id, name: "PingZest Pro Monthly", status: "ACTIVE", admin_graphql_api_shop_id: "gid://shopify/Shop/1", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), currency: "USD", capped_amount: null },
    });
    await page.goto(app.adminUrl("/app/plan", { upgraded: "1" }), { waitUntil: "networkidle" });
    await checkPage(page, "Plan (pro)");
    await r.caption(page, "You're on Pro", "Back in the app after approval: the plan switched to Pro and the trial end date is shown.");
    await r.point(page, page.getByText("You're on Pro. Thank you!"), 2400);
    await r.point(page, page.locator(".wa-sidebar__plan"), 1600);

    // Settings: money-savers
    await r.nav(page, "Settings", "/app/settings");
    await r.click(page, page.getByRole("tab", { name: /COD money-savers/ }));
    await r.caption(page, "COD money-savers, now unlocked", "Tag risky COD orders, offer a discount for paying online, and let customers fix their address.");
    const check = async (name) => { const box = page.locator(`input[name="${name}"]`); if (!(await box.isChecked())) await r.click(page, box.locator(".."), 700); else await r.point(page, box.locator(".."), 700); };
    await check("riskTagHigh");
    await r.point(page, page.locator('input[name="riskTag"]'), 900);
    await check("prepaidEnabled");
    const pct = page.locator('input[name="prepaidPercent"]');
    await r.point(page, pct, 500);
    await pct.fill("5");
    const max = page.locator('input[name="prepaidMaxAmount"]');
    await max.fill("100");
    await r.caption(page, "Pay online, save 5%", "Customers who switch from COD to prepaid get 5% off (up to ₹100). Prepaid orders almost never come back.");
    await r.beat(page, 1800);
    await check("addressCheck");
    await r.click(page, page.getByRole("tab", { name: "Orders" }));
    await r.caption(page, "Autopilot", "Expire unanswered orders automatically, and cancel + restock them in Shopify when they expire or the customer cancels.");
    await page.locator('input[name="codAutoExpire"]').scrollIntoViewIfNeeded();
    await check("codAutoExpire");
    await check("cancelOnCustomer");
    await check("cancelOnExpire");
    await r.click(page, page.getByRole("button", { name: "Save settings" }), 1000);
    await waitDb(async () => { const s = await prisma.shopSettings.findUnique({ where: { shop: SHOP } }); return s.codAutoExpire && s.prepaidEnabled && s.addressCheck && s.riskTagHigh; });
    await r.beat(page, 1500);
  });

  // A new risky order arrives while the merchant works.
  D.risky2 = await addOrder(person("Rakesh Kumar", "Patna", "800001", "+910000000000", "na", "Banarasi Silk Saree", "18999.00", { orders_count: 0, order: { email: "rk@mailinator.com", line_items: [{ title: "Banarasi Silk Saree", quantity: 4, price: "4750.00" }] } }), { name: "#1046" });
  D.sunita = await addOrder(person("Sunita Joshi", "Nagpur", "440010", "+919823012345", "Plot 18, Dharampeth", "Paithani Saree", "2000.00", { address2: "" }), { name: "#1047" });
  await app.act("/app/cod", { intent: "sent", id: D.sunita.id, templateId: "", templateName: "Standard", lang: "en" });
  D.sanjay = await addOrder(person("Sanjay Gupta", "Indore", "452001", "+919826012345", "22, Vijay Nagar", "Kurta Set", "1899.00"), { name: "#1048", hoursAgo: 82, sentHoursAgo: 80 });

  await r.segment("pro-admin-2", {}, async (page) => {
    await page.goto(app.adminUrl("/app/cod"), { waitUntil: "networkidle" });
    await checkPage(page, "COD (pro)");
    await r.caption(page, "Risk score on every COD order", "Pro scores each order: fake-looking numbers, incomplete addresses, unusual order values, past cancellations.");
    await r.beat(page, 2600);
    await r.click(page, page.locator(".wa-risk-filter").getByRole("link", { name: "High risk" }));
    await page.waitForURL((u) => new URL(u).searchParams.get("risk") === "high");
    await page.waitForLoadState("networkidle");
    await r.caption(page, "Filter: High risk", "See why each order looks risky, call the customer or ask for prepaid before you ship. It's also tagged in Shopify.");
    await r.point(page, page.locator(".wa-risk__why").first(), 3200);
  });

  await r.segment("pro-phone", { phone: true }, async (page) => {
    const row = await prisma.order.findUnique({ where: { id: D.sunita.id } });
    await page.goto(`${app.BASE}/c/${row.confirmToken}?l=en`, { waitUntil: "networkidle" });
    await checkPage(page, "confirm page (pro)");
    await r.caption(page, "Confirm page with Pro", "Sunita sees her order, a pay-online offer and her delivery address.");
    await r.beat(page, 2600);
    await r.scroll(page, 380);
    await r.click(page, page.locator(".cf__addr .cf__link"), 1000);
    const line2 = page.locator('input[name="address2"]');
    await r.point(page, line2, 500);
    await line2.pressSequentially("Opp. Dharampeth Post Office", { delay: 45 });
    await r.caption(page, "Fix the address", "She adds a landmark so the courier finds her. The address is updated on the Shopify order.");
    await r.click(page, page.locator(".cf__form .cf__btn--yes"), 1000);
    await page.locator(".cf__addr .cf__note--ok").waitFor({ timeout: 10000 });
    await r.beat(page, 1800);
    await r.scroll(page, -600);
    await r.caption(page, "Pay online and save", "Paying now takes 5% off the order in Shopify and opens the store's payment page.");
    await r.click(page, page.locator(".cf__btn--pay"), 1400);
    await page.waitForURL(/pay\.demo\.local/, { timeout: 15000 });
    await r.caption(page, "Paid online", "The COD order is now prepaid: no cash to collect, and almost no risk of a return.");
    await r.beat(page, 3000);
  });

  // Shopify reports the payment.
  const sunitaOrder = app.shopify.state.orders.get(D.sunita.orderGid);
  if (sunitaOrder) sunitaOrder.financialStatus = "PAID";
  await app.webhook("/webhooks/orders-paid", "orders/paid", {
    id: Number(D.sunita.shopifyOrderId), admin_graphql_api_id: D.sunita.orderGid, name: "#1047", financial_status: "paid", total_price: "1900.00", currency: "INR",
    payment_gateway_names: ["Cash on Delivery (COD)", "Razorpay"], phone: "+919823012345",
  });
  await prisma.shopSettings.update({ where: { shop: SHOP }, data: { codProcessedAt: null } });

  await r.segment("pro-admin-3", {}, async (page) => {
    await page.goto(app.adminUrl("/app/cod", { filter: "confirmed" }), { waitUntil: "networkidle" });
    await checkPage(page, "COD confirmed (pro)");
    await r.caption(page, "Paid online, address updated", "Sunita's order is confirmed, marked Paid online and tagged prepaid in Shopify.");
    await r.point(page, page.locator("tr", { hasText: "#1047" }).getByText("Paid online"), 2400);
    await r.point(page, page.locator("tr", { hasText: "#1047" }).getByText("Address updated by customer"), 2000);

    await r.click(page, page.locator(".wa-tabs").getByRole("link", { name: /^No reply/ }));
    await page.waitForLoadState("networkidle");
    await r.caption(page, "Autopilot at work", "Sanjay never replied. When the app opened, autopilot expired the order and cancelled + restocked it in Shopify.");
    await r.point(page, page.locator("tr", { hasText: "#1048" }).first(), 3200);

    await r.nav(page, "Analytics", "/app/analytics");
    await r.click(page, page.locator(".wa-tabs").getByRole("link", { name: /^Returns/ }));
    await page.waitForLoadState("networkidle");
    await r.click(page, page.locator(".wa-seg--links").getByRole("link", { name: /90/ }));
    await page.waitForLoadState("networkidle");
    await r.caption(page, "Returns insights", "Where returns come from: by PIN code, first order vs repeat, coupon use and order hour, and confirmed vs not.");
    await r.beat(page, 2600);
    await r.point(page, page.getByText("Where returns come from").first(), 1800);
    await r.scroll(page, 450);
    await r.point(page, page.getByText("First order vs repeat").first(), 1600);
    await r.scroll(page, 450);
    await r.point(page, page.getByText("Order time").first(), 1600);
    await r.scroll(page, -900);
    const dl = page.waitForEvent("download", { timeout: 10000 }).catch(() => null);
    await r.caption(page, "Export CSV", "Download the breakdowns to share with your courier or block risky PIN codes for COD.");
    await r.click(page, page.getByRole("button", { name: "Export CSV" }), 1600);
    const file = await dl;
    if (!file) problems.push("Export CSV: no download");
    else console.log(`  [pro] CSV downloaded: ${file.suggestedFilename()}`);
    await r.beat(page, 1600);

    await r.nav(page, "Message templates", "/app/templates");
    await r.caption(page, "Unlimited templates", "The 5-template limit is gone on Pro: create as many as you need.");
    await r.click(page, page.locator("summary", { hasText: "+ New template" }));
    await r.click(page, page.getByRole("button", { name: "Copy of the standard message" }));
    const nameInput = page.getByPlaceholder("e.g. Short & friendly");
    await nameInput.fill("");
    await nameInput.pressSequentially("Diwali offer", { delay: 60 });
    await r.click(page, page.getByRole("button", { name: "Create template" }), 1000);
    await waitDb(async () => (await prisma.messageTemplate.count({ where: { shop: SHOP, name: "Diwali offer" } })) === 1);
    await page.waitForLoadState("networkidle");
    await r.point(page, page.locator(".wa-tpl-item__name", { hasText: "Diwali offer" }), 2200);

    await r.nav(page, "Widgets", "/app/widgets");
    const frame = page.frameLocator(".wa-preview-frame");
    await r.click(page, frame.locator(".wa-chat__bubble"));
    await r.caption(page, "No “Powered by PingZest”", "On Pro the chat widget carries only your brand, on the storefront and in the preview.");
    await r.point(page, frame.locator(".wa-chat__popup"), 3000);
    if (await frame.locator(".wa-chat__brand").count()) problems.push("Pro widget still shows Powered by PingZest");

    await r.nav(page, "Plan", "/app/plan");
    await r.caption(page, "Plan: Pro", "Current plan Pro with the trial end date. Cancel any time: the store moves back to Free and Shopify credits unused time.");
    await r.scroll(page, 400);
    await r.point(page, page.getByRole("button", { name: "Cancel Pro" }), 3200);
  });
  return r.segments;
}

/* ---------------- video files ---------------- */

function encode(segments, out) {
  const args = ["-y", "-loglevel", "error"];
  for (const s of segments) args.push("-i", s.path);
  const parts = segments.map((s, i) => s.phone
    ? `[${i}:v]fps=25,scale=-2:${H - 40},pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x1e293b,setsar=1[v${i}]`
    : `[${i}:v]fps=25,scale=${W}:${H},setsar=1[v${i}]`);
  const filter = `${parts.join(";")};${segments.map((_, i) => `[v${i}]`).join("")}concat=n=${segments.length}:v=1:a=0[out]`;
  args.push("-filter_complex", filter, "-map", "[out]", "-c:v", "libx264", "-preset", "veryfast", "-crf", process.env.DEMO_CRF || "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out);
  execFileSync("ffmpeg", args, { stdio: "inherit" });
  const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "default=nw=1", out]).toString().replace(/\n/g, " ");
  console.log(`VIDEO-INFO ${out} ${(statSync(out).size / 1e6).toFixed(2)} MB ${probe}`);
}

/* ---------------- run ---------------- */

try {
  app = await startApp({ port: 3300, log: "/tmp/pingzest-demo.log" });
  browser = await chromium.launch();
  await seed();
  const free = await freeVideo();
  encode(free, join(OUT, "pingzest-free.mp4"));
  const pro = await proVideo();
  encode(pro, join(OUT, "pingzest-pro.mp4"));
  writeFileSync(join(OUT, "problems.txt"), problems.join("\n"));
} catch (e) {
  problems.push(`demo failed: ${e.stack || e.message}`);
} finally {
  await browser?.close().catch(() => {});
  await app?.stop().catch(() => {});
}

const unknown = app?.shopify.calls.filter((c) => c.op.startsWith("unhandled") || c.op === "graphql_error") || [];
for (const c of unknown) problems.push(`Shopify call problem: ${c.op} ${JSON.stringify(c.variables).slice(0, 300)}`);
if (problems.length) {
  console.error(`DEMO PROBLEMS (${problems.length}):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("Demo videos recorded without errors.");
