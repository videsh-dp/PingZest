import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultConfig, sanitizeConfig, sanitizePageRules, matchesPage, pathMatches, discountApplyUrl, describeRules,
} from "../app/lib/widget-config.js";

test("defaults survive a round trip through sanitize", () => {
  assert.deepEqual(sanitizeConfig(defaultConfig()), defaultConfig());
  assert.deepEqual(sanitizeConfig(null), defaultConfig());
  assert.deepEqual(sanitizeConfig("garbage"), defaultConfig());
});

test("sanitize keeps valid values and rejects bad ones", () => {
  const c = sanitizeConfig({
    chat: {
      style: { shape: "circle", size: "xl", bg: "#ABCDEF", fg: "red", label: "x".repeat(100) },
      desktop: { position: "top-left", offsetX: 9999, offsetY: "40" },
      mobile: { show: "false", iconOnly: false },
      agents: [{ name: "A", phone: "98765 43210" }, { name: "", phone: "" }, "bad"],
      hours: { open: -5, close: 30, days: "weekends" },
    },
    discount: { code: " welcome-10 off!", layout: "card", style: { shape: "pill", accent: "#fff" } },
    buttons: { style: "outline", shape: "pill", bg: "#000" },
  });
  assert.equal(c.chat.style.shape, "circle");
  assert.equal(c.chat.style.size, "md");
  assert.equal(c.chat.style.bg, "#abcdef");
  assert.equal(c.chat.style.fg, "#ffffff");
  assert.equal(c.chat.style.label.length, 40);
  assert.equal(c.chat.desktop.position, "bottom-right");
  assert.equal(c.chat.desktop.offsetX, 200);
  assert.equal(c.chat.desktop.offsetY, 40);
  assert.equal(c.chat.mobile.show, false);
  assert.equal(c.chat.mobile.iconOnly, false);
  assert.deepEqual(c.chat.agents, [{ name: "A", phone: "98765 43210" }]);
  assert.equal(c.chat.hours.open, 0);
  assert.equal(c.chat.hours.close, 24);
  assert.equal(c.chat.hours.days, "mon_sat");
  assert.equal(c.discount.code, "WELCOME-10OFF");
  assert.equal(c.discount.layout, "card");
  assert.equal(c.discount.style.shape, "pill");
  assert.equal(c.discount.style.accent, "#fff");
  assert.equal(c.buttons.style, "outline");
  assert.equal(c.buttons.bg, "#000");
});

test("page rules sanitize: unknown page types, bad paths, textarea input", () => {
  const r = sanitizePageRules({ mode: "include", pageTypes: ["product", "hacker", "product"], paths: "/pages/contact\nproducts/x, /collections/*" });
  assert.deepEqual(r, { mode: "include", pageTypes: ["product"], paths: ["/pages/contact", "/collections/*"] });
  assert.deepEqual(sanitizePageRules({ mode: "nope" }), { mode: "all", pageTypes: [], paths: [] });
});

test("pathMatches handles wildcards, case and trailing slashes", () => {
  assert.equal(pathMatches("/products/*", "/products/blue-kurta"), true);
  assert.equal(pathMatches("/products/*", "/collections/x"), false);
  assert.equal(pathMatches("/pages/contact", "/pages/Contact/"), true);
  assert.equal(pathMatches("/", "/"), true);
  assert.equal(pathMatches("/", "/products/x"), false);
  assert.equal(pathMatches("*sale*", "/collections/summer-sale"), true);
  assert.equal(pathMatches("*/sale*", "/collections/summer-sale"), false);
  assert.equal(pathMatches("/a.b", "/axb"), false);
});

test("matchesPage modes", () => {
  const product = { pageType: "product", path: "/products/kurta" };
  const contact = { pageType: "page", path: "/pages/contact" };
  assert.equal(matchesPage({ mode: "all" }, product), true);
  assert.equal(matchesPage(undefined, product), true);
  const inc = { mode: "include", pageTypes: ["product"], paths: ["/pages/contact"] };
  assert.equal(matchesPage(inc, product), true);
  assert.equal(matchesPage(inc, contact), true);
  assert.equal(matchesPage(inc, { pageType: "index", path: "/" }), false);
  const exc = { mode: "exclude", pageTypes: ["cart"], paths: ["/checkout*"] };
  assert.equal(matchesPage(exc, product), true);
  assert.equal(matchesPage(exc, { pageType: "cart", path: "/cart" }), false);
  assert.equal(matchesPage({ mode: "include", pageTypes: [], paths: [] }, product), false);
});

test("discount link and rule descriptions", () => {
  assert.equal(discountApplyUrl("WELCOME10", "/products/a?x=1"), "/discount/WELCOME10?redirect=%2Fproducts%2Fa%3Fx%3D1");
  assert.equal(describeRules({ mode: "all" }), "All pages");
  assert.equal(describeRules({ mode: "include", pageTypes: ["product", "cart"], paths: ["/pages/faq"] }), "Only on: Product pages, Cart, /pages/faq");
  assert.equal(describeRules({ mode: "exclude", pageTypes: [], paths: [] }), "Everywhere except: nothing selected");
});
