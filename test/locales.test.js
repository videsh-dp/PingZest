import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractKeys, KEEP_ENGLISH } from "../scripts/extract-i18n.mjs";
import { LOCALES, createT } from "../app/i18n/core.js";

const keys = extractKeys();
const load = (l) => JSON.parse(readFileSync(new URL(`../app/i18n/locales/${l}.json`, import.meta.url), "utf8"));
const vars = (s) => [...new Set(String(s).match(/\{[a-z_]+\}/g) || [])].sort();

for (const locale of Object.keys(LOCALES).filter((l) => l !== "en")) {
  test(`${locale}: every UI string is translated`, () => {
    const dict = load(locale);
    const missing = keys.filter((k) => !(k in dict) && !KEEP_ENGLISH.has(k));
    assert.deepEqual(missing, []);
  });
  test(`${locale}: placeholders survive translation`, () => {
    const dict = load(locale);
    for (const [k, v] of Object.entries(dict)) {
      if (typeof v === "string") assert.deepEqual(vars(v), vars(k), `${locale}: ${k}`);
      else assert.ok(v.other, `${locale}: plural ${k} needs "other"`);
    }
  });
  test(`${locale}: plurals render`, () => {
    const t = createT(locale, load(locale));
    for (const n of [0, 1, 2, 5, 11, 100]) {
      const s = t.plural("{count} COD order needs confirmation.", "{count} COD orders need confirmation.", n);
      assert.ok(s && !s.includes("{"), `${locale} ${n}: ${s}`);
    }
  });
}

test("no stale keys left in locale files", () => {
  const set = new Set(keys);
  for (const l of Object.keys(LOCALES).filter((x) => x !== "en")) {
    const stale = Object.keys(load(l)).filter((k) => !set.has(k));
    assert.deepEqual(stale, [], l);
  }
});

import { CONFIRM_TEXTS } from "../app/i18n/confirm.js";
import { DEFAULT_TEMPLATES, TEMPLATE_TYPES, LANGUAGES, validateTemplate } from "../app/lib/templates.js";
import { sanitizeTranslations, sanitizeConfig } from "../app/lib/widget-config.js";
import { withLang, composeMessage } from "../app/lib/compose.js";

test("confirm page has every text in every language", () => {
  const keys = Object.keys(CONFIRM_TEXTS.en).sort();
  for (const l of Object.keys(LOCALES)) {
    assert.deepEqual(Object.keys(CONFIRM_TEXTS[l]).sort(), keys, l);
    for (const k of keys) assert.deepEqual(vars(CONFIRM_TEXTS[l][k]), vars(CONFIRM_TEXTS.en[k]), `${l}.${k}`);
  }
});

test("default templates exist and are valid for every stage and language", () => {
  assert.deepEqual(Object.keys(LANGUAGES).sort(), Object.keys(LOCALES).sort());
  for (const type of Object.keys(TEMPLATE_TYPES)) {
    for (const lang of Object.keys(LANGUAGES)) {
      const body = DEFAULT_TEMPLATES[type][lang];
      assert.ok(body, `${type}/${lang}`);
      assert.equal(validateTemplate({ type, lang, name: "Standard", body }), null, `${type}/${lang}`);
      assert.deepEqual(vars(body), vars(DEFAULT_TEMPLATES[type].en), `${type}/${lang} variables`);
    }
  }
});

test("widget translations: only known texts, trimmed and clamped", () => {
  const t = sanitizeTranslations({
    es: { "chat.style.label": "  Chatea  ", "chat.unknown": "x", "discount.applyLabel": "A".repeat(99) },
    "pt-BR": { "chat.greeting": "Olá" },
    "bad locale!": { "chat.greeting": "x" },
    fr: { "chat.greeting": "" },
  });
  assert.deepEqual(Object.keys(t).sort(), ["es", "pt-BR"]);
  assert.equal(t.es["chat.style.label"], "Chatea");
  assert.equal(t.es["chat.unknown"], undefined);
  assert.equal(t.es["discount.applyLabel"].length, 30);
  assert.deepEqual(sanitizeConfig({}).translations, {});
  assert.deepEqual(sanitizeConfig({ translations: { de: { "chat.popup.title": "Hallo" } } }).translations, { de: { "chat.popup.title": "Hallo" } });
});

test("confirm link opens in the message's language", () => {
  assert.equal(withLang("https://x.app/c/abc", "es"), "https://x.app/c/abc?l=es");
  assert.equal(withLang("https://x.app/c/abc", "en"), "https://x.app/c/abc");
  assert.equal(withLang("", "es"), "");
  const m = composeMessage("Confirma: {confirm_link}", { confirm_link: "https://x.app/c/abc" }, "919876543210", "pt-BR");
  assert.match(m.message, /\/c\/abc\?l=pt-BR$/);
});
