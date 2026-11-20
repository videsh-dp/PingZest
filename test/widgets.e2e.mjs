// Browser test for the storefront widgets (v2, config-driven).
// Serves the extension assets + a harness page that mirrors the rendered Liquid, injecting
// widget config and page context per test, then checks every flow in Chromium.
// Run: node test/widgets.e2e.mjs   (needs Playwright: npx playwright install chromium)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { defaultConfig } from "../app/lib/widget-config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.join(here, "..", "extensions", "wa-widgets", "assets");
const shotDir = path.join(here, "widgets");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const cart = {
  currency: "INR", total_price: 389700,
  items: [
    { product_title: "Blue Cotton Kurta", variant_title: "M", quantity: 2, final_line_price: 259800, variant_id: 111 },
    { product_title: "Silk Dupatta", variant_title: "Default Title", quantity: 1, final_line_price: 129900, variant_id: 222 },
  ],
};
let beacons = [];
const cartUpdates = [];
const scenarios = new Map();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/assets/")) {
    const file = path.join(ext, path.basename(url.pathname));
    res.writeHead(200, { "Content-Type": file.endsWith(".js") ? "text/javascript" : "text/css" });
    return res.end(fs.readFileSync(file));
  }
  if (url.pathname === "/cart.js") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(cart)); }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (url.pathname === "/apps/wa-assist/track") { beacons.push(JSON.parse(body)); res.writeHead(204); return res.end(); }
    if (url.pathname === "/cart/update.js") { cartUpdates.push(JSON.parse(body)); res.writeHead(200); return res.end("{}"); }
    const sc = scenarios.get(url.searchParams.get("s")) || {};
    const html = fs.readFileSync(path.join(here, "widgets", "harness.html"), "utf8")
      .replace("__CONFIG__", JSON.stringify(sc.config ?? defaultConfig()))
      .replace("__PAGE__", JSON.stringify({ pageType: "product", product: "Blue Cotton Kurta", shop: "kurta-house.myshopify.com", currency: "INR", root: "/", ...(sc.page || {}) }));
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  });
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

function scenario(name, mutate, page) {
  const config = defaultConfig();
  config.chat.agents = [{ name: "Support", phone: "98765 43210" }, { name: "Sales – Rahul", phone: "+91 91234 56789" }];
  config.chat.tooltip.delaySec = 0;
  config.discount.enabled = true;
  config.discount.code = "WELCOME10";
  // the harness puts every inline block on one page, so let them all show by default
  for (const k of ["product", "cart", "share"]) config.buttons[k].pages = { mode: "all", pageTypes: [], paths: [] };
  mutate?.(config);
  scenarios.set(name, { config, page });
  return `${base}/products/blue-cotton-kurta?utm_source=ig&s=${name}`;
}

const browser = await chromium.launch();
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(`ok   ${name}`); } catch (e) { results.push(`FAIL ${name}\n     ${e.message}`); }
};
const text = (u) => new URL(u).searchParams.get("text");

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  const page = await ctx.newPage();
  const opened = [];
  const errors = [];
  await page.exposeFunction("__recordOpen", (u) => opened.push(u));
  await page.addInitScript(() => {
    window.open = (url) => {
      if (url) { window.__recordOpen(url); return {}; }
      const fake = { opener: 1, location: {} };
      Object.defineProperty(fake.location, "href", { set: (u) => window.__recordOpen(u) });
      return fake;
    };
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return { page, opened, errors, ctx };
}

try {
  /* ---------- desktop, default design ---------- */
  const { page, opened, errors } = await newPage();
  beacons = [];
  await page.goto(scenario("default"));

  await check("chat renders from app config with design classes and colours", async () => {
    const cls = await page.getAttribute(".wa-chat", "class");
    for (const c of ["wa-chat--pill", "wa-chat--md", "wa-chat--d-right", "wa-chat--m-icon"]) assert.ok(cls.includes(c), cls);
    const bg = await page.$eval(".wa-chat__bubble", (b) => getComputedStyle(b).backgroundColor);
    assert.equal(bg, "rgb(31, 143, 78)");
  });

  await check("tooltip appears and opens the popup", async () => {
    await page.waitForSelector(".wa-chat__tooltip:not([hidden])", { timeout: 2000 });
    assert.match(await page.textContent(".wa-chat__tooltip-text"), /Need help/);
    await page.click(".wa-chat__tooltip-text");
    await page.waitForSelector(".wa-chat__popup:not([hidden])");
    assert.equal(await page.isHidden(".wa-chat__tooltip"), true);
  });

  await check("popup lists agents with avatars; click opens wa.me with product greeting", async () => {
    const names = await page.$$eval(".wa-chat__agent-name", (els) => els.map((e) => e.textContent));
    assert.deepEqual(names, ["Support", "Sales – Rahul"]);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(shotDir, "desktop.png") });
    await page.click(".wa-chat__agent >> nth=1");
    await page.waitForTimeout(100);
    const u = opened.at(-1);
    assert.ok(u.startsWith("https://wa.me/919123456789?text="), u);
    assert.equal(text(u), `Hi! I have a question about Blue Cotton Kurta: ${base}/products/blue-cotton-kurta`);
  });

  await check("discount bar is first in <body>, shows code and an apply link back to this page", async () => {
    const first = await page.evaluate(() => document.body.firstElementChild.getAttribute("data-wa-widget"));
    assert.equal(first, "discount");
    assert.equal(await page.textContent(".wa-disc__code"), "WELCOME10");
    const href = await page.getAttribute(".wa-disc__btn--apply", "href");
    assert.equal(href, "/discount/WELCOME10?redirect=%2Fproducts%2Fblue-cotton-kurta%3Futm_source%3Dig%26s%3Ddefault");
  });

  await check("copy button copies the code", async () => {
    await page.click(".wa-disc__btn--copy");
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "WELCOME10");
    assert.equal(await page.textContent(".wa-disc__btn--copy"), "Copied!");
  });

  await check("inline buttons get app styles; product button falls back to the chat agent's number", async () => {
    const cls = await page.getAttribute('[data-wa-widget="product"]', "class");
    assert.ok(cls.includes("wa-btn--solid") && cls.includes("wa-btn--shape-rounded"), cls);
    await page.click('[data-wa-widget="product"]');
    await page.waitForTimeout(100);
    assert.ok(opened.at(-1).startsWith("https://wa.me/919876543210?text="), opened.at(-1));
  });

  await check("cart button sends items, totals and a cart permalink", async () => {
    await page.click('[data-wa-widget="cart"]');
    await page.waitForTimeout(400);
    const msg = text(opened.at(-1));
    assert.match(msg, /• 2 × Blue Cotton Kurta \(M\) – ₹2,598/);
    assert.match(msg, /Total: ₹3,897/);
    assert.match(msg, /\/cart\/111:2,222:1$/);
  });

  await check("tracking: one batched view request, then one request per click", async () => {
    const views = beacons.filter((b) => b.events.every((e) => e.event === "view"));
    assert.equal(views.length, 1, JSON.stringify(beacons));
    assert.deepEqual(views[0].events.map((e) => e.widget).sort(), ["cart", "chat", "discount", "product", "share"]);
    assert.equal(views[0].pageType, "product");
    assert.equal(views[0].device, "desktop");
    const clicks = beacons.flatMap((b) => b.events).filter((e) => e.event !== "view").map((e) => `${e.widget}:${e.event}`);
    assert.deepEqual(clicks, ["chat:click", "discount:copy", "product:click", "cart:click"]);
  });

  await check("dismissing the banner is remembered after reload", async () => {
    await page.click(".wa-disc__x");
    assert.equal(await page.$(".wa-disc"), null);
    await page.reload();
    await page.waitForTimeout(200);
    assert.equal(await page.$(".wa-disc"), null);
  });

  await check("no JavaScript errors", async () => assert.deepEqual(errors, []));

  /* ---------- page rules ---------- */
  await check("page rules: chat hidden on cart, share hidden on product, banner only on home", async () => {
    const { page: p, ctx } = await newPage();
    await p.goto(scenario("rules", (c) => {
      c.chat.pages = { mode: "exclude", pageTypes: ["cart"], paths: [] };
      c.buttons.share.pages = { mode: "exclude", pageTypes: ["product"], paths: [] };
      c.discount.pages = { mode: "include", pageTypes: ["index"], paths: [] };
    }, { pageType: "cart", product: null }));
    assert.equal(await p.$(".wa-chat"), null, "chat should be hidden on cart");
    assert.equal(await p.$(".wa-disc"), null, "banner should only be on home");
    await p.goto(scenario("rules2", (c) => {
      c.buttons.share.pages = { mode: "exclude", pageTypes: ["product"], paths: [] };
      c.discount.pages = { mode: "include", pageTypes: [], paths: ["/products/*"] };
    }));
    assert.equal(await p.isHidden('[data-wa-block="share"]'), true);
    assert.ok(await p.$(".wa-disc"), "banner should match /products/* path");
    assert.ok(await p.$(".wa-chat"));
    await ctx.close();
  });

  await check("design options: circle, large, left, custom colours, outline pill buttons, pulse", async () => {
    const { page: p, ctx } = await newPage();
    await p.goto(scenario("design", (c) => {
      Object.assign(c.chat.style, { shape: "circle", size: "lg", bg: "#6b21a8", fg: "#ffffff", pulse: true, icon: "phone" });
      c.chat.desktop = { show: true, position: "bottom-left", offsetX: 40, offsetY: 60 };
      Object.assign(c.buttons, { style: "outline", shape: "pill", bg: "#6b21a8" });
      c.discount.layout = "card";
      c.discount.style = { bg: "#fff7e6", fg: "#3d2a00", accent: "#b45309", shape: "pill", size: "lg" };
    }));
    const box = await p.locator(".wa-chat__bubble").boundingBox();
    assert.equal(Math.round(box.width), 62);
    assert.equal(Math.round(box.x), 40);
    assert.equal(Math.round(800 - box.y - box.height), 60);
    assert.equal(await p.isHidden(".wa-chat__label"), true);
    await p.waitForTimeout(300); // let colour transitions finish
    const btn = await p.$eval('[data-wa-widget="share"]', (b) => [getComputedStyle(b).borderRadius, getComputedStyle(b).color]);
    assert.equal(btn[1], "rgb(107, 33, 168)");
    assert.ok(parseFloat(btn[0]) > 100);
    const card = await p.locator(".wa-disc--card").boundingBox();
    assert.ok(card.x > 600, `card should sit opposite the chat (right side), x=${card.x}`);
    await p.waitForTimeout(250);
    await p.screenshot({ path: path.join(shotDir, "design-variant.png") });
    await ctx.close();
  });

  /* ---------- mobile ---------- */
  await check("mobile: icon-only chat at mobile position, card becomes bottom sheet, popup fits", async () => {
    await new Promise((r) => setTimeout(r, 1000)); // let earlier pages flush their beacons
    const { page: p, ctx } = await newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    beacons = [];
    await p.goto(scenario("mobile", (c) => {
      c.chat.mobile = { show: true, position: "bottom-left", offsetX: 12, offsetY: 90, iconOnly: true };
      c.discount.layout = "card";
      c.chat.tooltip.enabled = false;
    }));
    assert.equal(await p.isHidden(".wa-chat__label"), true);
    const b = await p.locator(".wa-chat__bubble").boundingBox();
    assert.equal(Math.round(b.x), 12);
    assert.equal(Math.round(b.width), 52);
    const card = await p.locator(".wa-disc--card").boundingBox();
    assert.equal(Math.round(card.width), 390);
    assert.equal(Math.round(card.y + card.height), 780);
    await p.waitForTimeout(300);
    const lifted = await p.locator(".wa-chat__bubble").boundingBox();
    assert.ok(lifted.y + lifted.height <= card.y - 80, `chat should sit above the bottom sheet: ${JSON.stringify(lifted)} vs card y=${card.y}`);
    await p.screenshot({ path: path.join(shotDir, "mobile.png") });
    await p.click(".wa-disc__x");
    await p.waitForTimeout(300);
    const dropped = await p.locator(".wa-chat__bubble").boundingBox();
    assert.equal(Math.round(780 - dropped.y - dropped.height), 90, "chat returns to its offset after dismiss");
    await p.click(".wa-chat__bubble");
    const pop = await p.locator(".wa-chat__popup").boundingBox();
    assert.ok(pop.x >= 0 && pop.x + pop.width <= 390, JSON.stringify(pop));
    await p.waitForTimeout(900);
    assert.equal(beacons[0].device, "mobile");
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 390);
    await ctx.close();
  });

  await check("mobile hide + popup layout", async () => {
    const { page: p } = await newPage({ viewport: { width: 390, height: 780 }, isMobile: true });
    await p.goto(scenario("mhide", (c) => { c.chat.mobile.show = false; c.discount.layout = "popup"; }));
    assert.equal(await p.isHidden(".wa-chat"), true);
    const box = await p.locator(".wa-disc__box").boundingBox();
    assert.ok(box.width <= 358 && box.y > 100, JSON.stringify(box));
    await p.waitForTimeout(250);
    await p.screenshot({ path: path.join(shotDir, "mobile-popup.png") });
  });

  await check("business hours logic (IST, Mon–Sat 10–19, overnight)", async () => {
    const r = await page.evaluate(() => {
      const h = { enabled: true, open: 10, close: 19, days: "mon_sat", utcOffset: 330 };
      const W = window.WAWidgets;
      return [
        W.isOpen(h, new Date("2026-11-23T06:30:00Z")),
        W.isOpen(h, new Date("2026-11-23T14:30:00Z")),
        W.isOpen(h, new Date("2026-11-22T06:30:00Z")),
        W.isOpen({ enabled: true, open: 20, close: 2, days: "all", utcOffset: 0 }, new Date("2026-11-23T01:00:00Z")),
      ];
    });
    assert.deepEqual(r, [true, false, false, true]);
  });

  await check("storefront page-rule matcher agrees with the app's", async () => {
    const { matchesPage, pathMatches } = await import("../app/lib/widget-config.js");
    const cases = [
      [{ mode: "include", pageTypes: ["product"], paths: [] }, { pageType: "product", path: "/products/a" }],
      [{ mode: "exclude", pageTypes: [], paths: ["/pages/*"] }, { pageType: "page", path: "/pages/faq/" }],
      [{ mode: "include", pageTypes: [], paths: ["*sale*"] }, { pageType: "collection", path: "/collections/big-sale" }],
      [{ mode: "all" }, { pageType: "index", path: "/" }],
    ];
    const browserResults = await page.evaluate((cs) => cs.map(([r, p]) => window.WAWidgets.matchesPage(r, p)), cases);
    assert.deepEqual(browserResults, cases.map(([r, p]) => matchesPage(r, p)));
    assert.equal(await page.evaluate(() => window.WAWidgets.pathMatches("/a.b", "/axb")), pathMatches("/a.b", "/axb"));
  });

  await check("no config saved yet → nothing floats, inline buttons still work", async () => {
    const { page: p, opened: o, errors: errs } = await newPage();
    scenarios.set("empty", { config: null });
    await p.goto(`${base}/products/x?s=empty`);
    assert.equal(await p.$(".wa-chat"), null);
    assert.equal(await p.$(".wa-disc"), null);
    await p.click('[data-wa-widget="share"]');
    await p.waitForTimeout(100);
    assert.ok(o.at(-1).startsWith("https://wa.me/?text="));
    assert.deepEqual(errs, []);
  });
} finally {
  await browser.close();
  server.close();
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
