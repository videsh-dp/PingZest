import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveLocale, createT, interpolate, dirOf, formatNumber, formatPercent, formatCurrency, formatDate, timeAgo, LOCALES,
} from "../app/i18n/core.js";
import { protect, restore, googleCode, translateTexts } from "../app/lib/translate.js";

test("resolveLocale: exact, same language, Accept-Language, fallback", () => {
  assert.equal(resolveLocale("es"), "es");
  assert.equal(resolveLocale("es-419"), "es");
  assert.equal(resolveLocale("pt-PT"), "pt-BR");
  assert.equal(resolveLocale("fr_CA"), "fr");
  assert.equal(resolveLocale("ja", "de-DE"), "de");
  assert.equal(resolveLocale("ar-AE,ar;q=0.9,en;q=0.8"), "ar");
  assert.equal(resolveLocale("ja-JP,ko;q=0.5"), "en");
  assert.equal(resolveLocale(undefined, null, ""), "en");
});

test("t: translation, fallback to English, interpolation, plurals", () => {
  const t = createT("es", {
    "Save settings": "Guardar ajustes",
    "Hi {name}": "Hola {name}",
    "{count} order needs confirmation|{count} orders need confirmation": { one: "{count} pedido por confirmar", other: "{count} pedidos por confirmar" },
  });
  assert.equal(t("Save settings"), "Guardar ajustes");
  assert.equal(t("Untranslated"), "Untranslated");
  assert.equal(t("Hi {name}", { name: "Ana" }), "Hola Ana");
  assert.equal(t.plural("{count} order needs confirmation", "{count} orders need confirmation", 1), "1 pedido por confirmar");
  assert.equal(t.plural("{count} order needs confirmation", "{count} orders need confirmation", 4), "4 pedidos por confirmar");
  const en = createT("en", {});
  assert.equal(en.plural("{count} item", "{count} items", 1), "1 item");
  assert.equal(en.plural("{count} item", "{count} items", 2), "2 items");
  assert.equal(interpolate("{a} {b}", { a: 1 }), "1 {b}");
});

test("Arabic plural categories come from Intl.PluralRules", () => {
  const t = createT("ar", { "{count} day|{count} days": { zero: "لا أيام", one: "يوم واحد", two: "يومان", few: "{count} أيام", many: "{count} يومًا", other: "{count} يوم" } });
  assert.equal(t.plural("{count} day", "{count} days", 0), "لا أيام");
  assert.equal(t.plural("{count} day", "{count} days", 2), "يومان");
  assert.equal(t.plural("{count} day", "{count} days", 5), "5 أيام");
  assert.equal(t.plural("{count} day", "{count} days", 11), "11 يومًا");
});

test("direction and formatting", () => {
  assert.equal(dirOf("ar"), "rtl");
  assert.equal(dirOf("es"), "ltr");
  assert.equal(Object.keys(LOCALES).length, 7);
  assert.equal(formatNumber(125000, "en"), "1,25,000");
  assert.equal(formatNumber(125000, "de"), "125.000");
  assert.equal(formatCurrency(1299, "INR", "en"), "₹1,299");
  assert.match(formatCurrency(19.5, "EUR", "fr"), /19,50\s?€/);
  assert.equal(formatPercent(0.257, "en"), "25.7%");
  assert.equal(formatPercent(null, "en"), "–");
  assert.equal(formatDate("2026-11-20", "es"), "20 nov");
  const now = new Date("2026-11-20T10:00:00Z").getTime();
  assert.equal(timeAgo(new Date(now - 5 * 60000), "en", now), "5 minutes ago");
  assert.equal(timeAgo(new Date(now - 5 * 60000), "es", now), "hace 5 minutos");
  assert.equal(timeAgo(new Date(now - 26 * 3600000), "en", now), "yesterday");
});

test("protect/restore keeps variables, links and formatting out of translation", () => {
  const src = "Hi {name}, your order is *confirmed*!\nTrack: https://t.co/x?a=1&b=2 & more <3";
  const { html, kept } = protect(src);
  assert.ok(!html.includes("{name}") && !html.includes("https://"));
  assert.deepEqual(kept, ["{name}", "*", "*", "https://t.co/x?a=1&b=2"]);
  assert.equal(restore(html, kept), src);
  // Google returns tags possibly as <x id="0"></x> and may move them; restore still works
  assert.equal(restore('Hola <x id="0"></x>, <x id="1"/>listo<x id="2"/><br/>', ["{name}", "*", "*"]), "Hola {name}, *listo*\n");
  assert.equal(googleCode("pt-BR"), "pt");
});

test("translateTexts sends protected HTML and restores the answer", async () => {
  process.env.GOOGLE_TRANSLATE_API_KEY = "test-key";
  let body;
  const fake = async (url, opts) => {
    body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ data: { translations: [{ translatedText: 'Hola <x id="0"/>' }, { translatedText: "" }] } }) };
  };
  const out = await translateTexts(["Hi {name}", ""], "es", "en", fake);
  assert.deepEqual(out, ["Hola {name}", ""]);
  assert.equal(body.target, "es");
  assert.equal(body.format, "html");
  delete process.env.GOOGLE_TRANSLATE_API_KEY;
  await assert.rejects(() => translateTexts(["x"], "es"), /GOOGLE_TRANSLATE_API_KEY/);
});
