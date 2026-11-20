import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizePhone, formatPhone } from "../app/lib/phone.js";
import { waLink, waShareLink, replyLink, prefillWarning, MAX_PREFILL_LENGTH } from "../app/lib/whatsapp.js";
import { renderTemplate, DEFAULT_TEMPLATES, getTemplateText, VARIABLES } from "../app/lib/templates.js";
import {
  isCodOrder, pickPhone, formatMoney, summariseItems, orderRecordFromWebhook,
  checkoutRecordFromWebhook, trackingFromFulfillment, hasWhatsappOptIn, isAbandoned, orderVars,
} from "../app/lib/orders.js";
import { generateToken, isValidTokenFormat, tokenExpiry, TOKEN_TTL_DAYS } from "../app/lib/tokens.js";

test("normalizePhone handles common Indian formats", () => {
  for (const raw of ["9876543210", "098765 43210", "+91 98765-43210", "0091 9876543210", "91 98765 43210", "(+91) 98765 43210"]) {
    assert.equal(normalizePhone(raw, "91"), "919876543210", raw);
  }
});

test("normalizePhone keeps other countries and rejects junk", () => {
  assert.equal(normalizePhone("+1 (415) 555-0100", "91"), "14155550100");
  assert.equal(normalizePhone("4155550100", "1"), "14155550100");
  assert.equal(normalizePhone("+971 50 123 4567", "91"), "971501234567");
  assert.equal(normalizePhone("12345", "91"), null);
  assert.equal(normalizePhone("", "91"), null);
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone("abc"), null);
  assert.equal(normalizePhone("+1234567890123456"), null);
});

test("formatPhone", () => {
  assert.equal(formatPhone("919876543210"), "+91 98765 43210");
  assert.equal(formatPhone("14155550100"), "+14155550100");
  assert.equal(formatPhone(null), "");
});

test("waLink encodes text including Hindi, emoji and newlines", () => {
  const url = waLink("919876543210", "नमस्ते 👋\nOrder #1042 & more");
  assert.ok(url.startsWith("https://wa.me/919876543210?text="));
  const decoded = decodeURIComponent(new URL(url).searchParams.get("text"));
  assert.equal(decoded, "नमस्ते 👋\nOrder #1042 & more");
  assert.equal(waLink("919876543210"), "https://wa.me/919876543210");
  assert.ok(waShareLink("hi").startsWith("https://wa.me/?text="));
  assert.equal(replyLink("919000000000", "CONFIRM #1"), "https://wa.me/919000000000?text=CONFIRM%20%231");
});

test("prefillWarning flags long messages only", () => {
  assert.equal(prefillWarning("short"), null);
  assert.match(prefillWarning("x".repeat(MAX_PREFILL_LENGTH + 1)), /cut off/);
});

test("renderTemplate fills variables, uses fallbacks, reports missing/unknown", () => {
  const r = renderTemplate("Hi {name}, order {order_no}. {confirm_link} {oops}", { order_no: "#1", confirm_link: "" });
  assert.equal(r.text, "Hi there, order #1.  {oops}");
  assert.deepEqual(r.missing, ["confirm_link"]);
  assert.deepEqual(r.unknown, ["oops"]);
  assert.equal(renderTemplate("Hi {name}", {}, { lang: "hi" }).text, "Hi जी");
});

test("every default template renders with no missing vars when data is complete", () => {
  const vars = Object.fromEntries(Object.keys(VARIABLES).map((k) => [k, `<${k}>`]));
  for (const [type, langs] of Object.entries(DEFAULT_TEMPLATES)) {
    for (const [lang, body] of Object.entries(langs)) {
      const r = renderTemplate(body, vars, { lang });
      assert.deepEqual(r.missing, [], `${type}/${lang}`);
      assert.deepEqual(r.unknown, [], `${type}/${lang}`);
      assert.ok(r.text.length < MAX_PREFILL_LENGTH);
    }
  }
});

test("getTemplateText prefers saved template", () => {
  assert.equal(getTemplateText([{ type: "shipped", lang: "en", body: "Custom" }], "shipped", "en"), "Custom");
  assert.equal(getTemplateText([], "shipped", "hi"), DEFAULT_TEMPLATES.shipped.hi);
  assert.equal(getTemplateText(null, "shipped", "fr"), DEFAULT_TEMPLATES.shipped.en);
});

test("isCodOrder recognises gateway names", () => {
  assert.equal(isCodOrder({ payment_gateway_names: ["Cash on Delivery (COD)"] }), true);
  assert.equal(isCodOrder({ payment_gateway_names: ["cod"] }), true);
  assert.equal(isCodOrder({ gateway: "Pay on delivery" }), true);
  assert.equal(isCodOrder({ payment_gateway_names: ["razorpay"] }), false);
  assert.equal(isCodOrder({ payment_gateway_names: ["Codex Payments"] }), false);
  assert.equal(isCodOrder({}), false);
});

test("pickPhone falls back through addresses", () => {
  assert.equal(pickPhone({ phone: null, shipping_address: { phone: "098765 43210" } }), "919876543210");
  assert.equal(pickPhone({ customer: { phone: "+919876543211" } }), "919876543211");
  assert.equal(pickPhone({}), null);
});

test("formatMoney and summariseItems", () => {
  assert.equal(formatMoney("1299.00", "INR"), "₹1,299");
  assert.equal(formatMoney("125000", "INR"), "₹1,25,000");
  assert.equal(formatMoney("19.5", "USD"), "$19.50");
  assert.equal(formatMoney("abc"), "");
  const items = [{ quantity: 2, title: "Kurta" }, { title: "Dupatta" }, { quantity: 1, title: "Bangles" }, { quantity: 3, title: "Socks" }];
  assert.equal(summariseItems(items), "2 × Kurta, 1 × Dupatta, 1 × Bangles (+1 more)");
});

const sampleOrder = {
  id: 5550001,
  admin_graphql_api_id: "gid://shopify/Order/5550001",
  name: "#1042",
  total_price: "1299.00",
  currency: "INR",
  payment_gateway_names: ["Cash on Delivery (COD)"],
  shipping_address: { first_name: "Priya", phone: "98765 43210" },
  line_items: [{ quantity: 1, title: "Blue Kurta" }],
  checkout_token: "chk123",
  order_status_url: "https://shop.example/status",
  note_attributes: [{ name: "WhatsApp updates", value: "yes" }],
  discount_codes: [{ code: "welcome10", amount: "129.90", type: "percentage" }],
  total_discounts: "129.90",
};

test("orderRecordFromWebhook builds a clean record", () => {
  const r = orderRecordFromWebhook(sampleOrder);
  assert.equal(r.shopifyOrderId, "5550001");
  assert.equal(r.orderName, "#1042");
  assert.equal(r.customerName, "Priya");
  assert.equal(r.phone, "919876543210");
  assert.equal(r.isCod, true);
  assert.equal(r.whatsappOptIn, true);
  assert.equal(r.itemsSummary, "1 × Blue Kurta");
  assert.equal(r.discountCodes, "WELCOME10");
  assert.equal(r.discountAmount, "129.90");
});

test("hasWhatsappOptIn only accepts yes-like values", () => {
  assert.equal(hasWhatsappOptIn({ note_attributes: [{ name: "WhatsApp updates", value: "no" }] }), false);
  assert.equal(hasWhatsappOptIn({}), false);
});

test("checkout + fulfillment parsing", () => {
  const c = checkoutRecordFromWebhook({ token: "t1", total_price: "500", phone: "9876543210", abandoned_checkout_url: "https://x/recover", line_items: [] });
  assert.equal(c.phone, "919876543210");
  assert.equal(c.completed, false);
  const f = trackingFromFulfillment({ order_id: 9, tracking_urls: ["https://track/1"], tracking_numbers: ["AWB1"], shipment_status: "delivered" });
  assert.deepEqual(f, { shopifyOrderId: "9", trackingUrl: "https://track/1", trackingNumber: "AWB1", status: "delivered" });
});

test("isAbandoned waits for the delay", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  assert.equal(isAbandoned({ updatedAt: "2026-11-20T09:00:00Z" }, now, 30), true);
  assert.equal(isAbandoned({ updatedAt: "2026-11-20T09:45:00Z" }, now, 30), false);
  assert.equal(isAbandoned({ updatedAt: "2026-11-20T09:00:00Z", completed: true }, now, 30), false);
});

test("orderVars + default COD template produce a sendable message", () => {
  const r = orderRecordFromWebhook(sampleOrder);
  const vars = orderVars(r, { storeName: "Kurta House", confirmLink: "https://app.example/c/abcDEF123456" });
  const msg = renderTemplate(DEFAULT_TEMPLATES.cod_confirm.en, vars).text;
  assert.match(msg, /Hi Priya/);
  assert.match(msg, /#1042/);
  assert.match(msg, /₹1,299/);
  assert.match(msg, /c\/abcDEF123456/);
});

test("tokens", () => {
  const t = generateToken();
  assert.equal(isValidTokenFormat(t), true);
  assert.notEqual(t, generateToken());
  assert.equal(isValidTokenFormat("../etc/passwd"), false);
  const exp = tokenExpiry(new Date("2026-01-01T00:00:00Z"));
  assert.equal((exp - new Date("2026-01-01T00:00:00Z")) / 86400000, TOKEN_TTL_DAYS);
});

test("default templates only use variables listed for their type", async () => {
  const { TEMPLATE_TYPES } = await import("../app/lib/templates.js");
  for (const [type, langs] of Object.entries(DEFAULT_TEMPLATES)) {
    for (const body of Object.values(langs)) {
      const used = [...body.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
      for (const v of used) assert.ok(TEMPLATE_TYPES[type].vars.includes(v), `${type} uses {${v}}`);
    }
  }
});

test("pickTemplate: explicit id, then default, then first, then built-in", async () => {
  const { pickTemplate } = await import("../app/lib/templates.js");
  const saved = [
    { id: 1, type: "cod_confirm", lang: "en", name: "A", body: "A {confirm_link}", isDefault: false },
    { id: 2, type: "cod_confirm", lang: "en", name: "B", body: "B {confirm_link}", isDefault: true },
    { id: 3, type: "cod_confirm", lang: "hi", name: "C", body: "C {confirm_link}", isDefault: false },
  ];
  assert.equal(pickTemplate(saved, "cod_confirm", "en", 1).name, "A");
  assert.equal(pickTemplate(saved, "cod_confirm", "en", "3").name, "C");
  assert.equal(pickTemplate(saved, "cod_confirm", "en").name, "B");
  assert.equal(pickTemplate(saved, "cod_confirm", "hi").name, "C");
  assert.equal(pickTemplate(saved, "cod_confirm", "en", 999).name, "B");
  const builtIn = pickTemplate([], "shipped", "hi");
  assert.equal(builtIn.id, null);
  assert.equal(builtIn.body, DEFAULT_TEMPLATES.shipped.hi);
});

test("composeMessage builds text, link and warnings", async () => {
  const { composeMessage } = await import("../app/lib/compose.js");
  const r = composeMessage("Hi {name}, {order_no}", { name: "Priya", order_no: "#1" }, "919876543210");
  assert.equal(r.message, "Hi Priya, #1");
  assert.equal(r.link, "https://wa.me/919876543210?text=Hi%20Priya%2C%20%231");
  assert.equal(composeMessage("x", {}, null).link, null);
});

test("starter templates only use their type's variables", async () => {
  const { STARTER_TEMPLATES, TEMPLATE_TYPES } = await import("../app/lib/templates.js");
  for (const [type, langs] of Object.entries(STARTER_TEMPLATES)) {
    for (const list of Object.values(langs)) for (const [, body] of list) {
      for (const m of body.matchAll(/\{([a-z_]+)\}/g)) assert.ok(TEMPLATE_TYPES[type].vars.includes(m[1]), `${type}: {${m[1]}}`);
    }
  }
});

test("validateTemplate", async () => {
  const { validateTemplate } = await import("../app/lib/templates.js");
  assert.equal(validateTemplate({ type: "shipped", lang: "en", name: "S", body: "Track {tracking_link}" }), null);
  assert.match(validateTemplate({ type: "shipped", lang: "en", name: "", body: "x" }), /name/);
  assert.match(validateTemplate({ type: "shipped", lang: "en", name: "S", body: "{oops}" }), /Unknown variable/);
  assert.match(validateTemplate({ type: "shipped", lang: "en", name: "S", body: "{checkout_link}" }), /isn't available/);
  assert.match(validateTemplate({ type: "cod_confirm", lang: "en", name: "C", body: "Hi {name}" }), /confirm_link/);
  assert.match(validateTemplate({ type: "nope", lang: "en", name: "C", body: "x" }), /Unknown stage/);
});
