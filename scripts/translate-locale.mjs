#!/usr/bin/env node
/**
 * Drafts a new admin language (or fills gaps in an existing one) with Google Cloud Translation.
 *   GOOGLE_TRANSLATE_API_KEY=... node scripts/translate-locale.mjs ja
 * Writes app/i18n/locales/<lang>.json. {placeholders}, links and WhatsApp formatting are protected.
 * Plural keys ("one|other") get "one" and "other" drafts; adjust other plural forms by hand.
 * Review the draft with a native speaker, then add the language to LOCALES in app/i18n/core.js
 * and to DICTIONARIES in app/i18n/dictionaries.js.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractKeys, KEEP_ENGLISH } from "./extract-i18n.mjs";
import { translateTexts } from "../app/lib/translate.js";

const lang = process.argv[2];
if (!lang) { console.error("Usage: node scripts/translate-locale.mjs <lang>"); process.exit(1); }
const file = join(dirname(fileURLToPath(import.meta.url)), "../app/i18n/locales", `${lang}.json`);
const dict = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
const todo = extractKeys().filter((k) => !(k in dict) && !KEEP_ENGLISH.has(k));
const texts = todo.flatMap((k) => k.split("|"));
console.log(`${todo.length} strings to translate into ${lang}…`);

const out = [];
for (let i = 0; i < texts.length; i += 100) out.push(...(await translateTexts(texts.slice(i, i + 100), lang, "en")));
let j = 0;
for (const k of todo) {
  if (k.includes("|")) { dict[k] = { one: out[j], other: out[j + 1] }; j += 2; }
  else dict[k] = out[j++];
}
writeFileSync(file, JSON.stringify(Object.fromEntries(Object.keys(dict).sort().map((k) => [k, dict[k]])), null, 2) + "\n");
console.log(`Wrote ${file}. Please have it reviewed before shipping.`);
