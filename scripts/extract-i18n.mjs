#!/usr/bin/env node
/**
 * Lists every string the admin UI translates: tr("…"), tr.plural("…","…"), N_("…").
 * Usage:  node scripts/extract-i18n.mjs            → prints JSON array of keys
 *         node scripts/extract-i18n.mjs --check    → exits 1 if a locale file misses keys
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Brand names, codes and example values that stay the same in every language. */
export const KEEP_ENGLISH = new Set([".myshopify.com", "WA Assist", "WELCOME10", "your-store"]);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const SINGLE = new RegExp(String.raw`\b(?:tr|N_)\(\s*` + STR, "g");
const PLURAL = new RegExp(String.raw`\btr\.plural\(\s*` + STR + String.raw`\s*,\s*` + STR, "g");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

export function extractKeys() {
  const keys = new Set();
  for (const file of walk(join(root, "app"))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(PLURAL)) keys.add(`${JSON.parse(`"${m[1]}"`)}|${JSON.parse(`"${m[2]}"`)}`);
    for (const m of src.matchAll(SINGLE)) keys.add(JSON.parse(`"${m[1]}"`));
  }
  return [...keys].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const keys = extractKeys();
  if (process.argv.includes("--check")) {
    const dir = join(root, "app/i18n/locales");
    let bad = 0;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "en.json")) {
      const dict = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const missing = keys.filter((k) => !(k in dict) && !KEEP_ENGLISH.has(k));
      if (missing.length) { bad++; console.log(`${f}: ${missing.length} missing`, missing.slice(0, 10)); }
    }
    process.exit(bad ? 1 : 0);
  }
  console.log(JSON.stringify(keys, null, 2));
}
