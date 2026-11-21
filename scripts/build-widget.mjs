#!/usr/bin/env node
/**
 * Builds the storefront script from widget-src/wa-widget.js (the readable source; edit that one):
 *   extensions/pingzest-widgets/assets/wa-widget-core.js  minified widgets
 *   extensions/pingzest-widgets/assets/wa-widget.js       tiny loader the theme blocks include
 * The blocks include only the loader, because Shopify's theme check limits app block JavaScript to
 * 10 KB; the loader fetches the core from the same CDN folder.
 *   npm run build:widget            build
 *   npm run build:widget -- --check fail if the committed files don't match the source (CI)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { transform } from "esbuild";

const SRC = "widget-src/wa-widget.js";
const CORE = "extensions/pingzest-widgets/assets/wa-widget-core.js";
const LOADER = "extensions/pingzest-widgets/assets/wa-widget.js";
const LIMIT = 10000;

const LOADER_JS = `/* PingZest: loads the storefront widgets (wa-widget-core.js, same folder) once. Built by scripts/build-widget.mjs; source in widget-src/. */
(function(){if(window.WAWidgets||window.__pingzestCore)return;window.__pingzestCore=1;var s=document.currentScript||document.querySelector('script[src*="/wa-widget.js"]');if(!s||!s.src)return;var e=document.createElement("script");e.src=s.src.replace(/wa-widget\\.js(?=[?#]|$)/,"wa-widget-core.js");e.async=false;(document.head||document.documentElement).appendChild(e)})();
`;

const { code } = await transform(readFileSync(SRC, "utf8"), { minify: true, target: "es2017", legalComments: "none" });
const core = `/* PingZest storefront widgets. Built by scripts/build-widget.mjs from widget-src/wa-widget.js; don't edit. */\n${code}`;

const check = process.argv.includes("--check");
const outputs = [[CORE, core], [LOADER, LOADER_JS]];
let stale = false;
for (const [file, content] of outputs) {
  if (check) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== content) {
      console.error(`${file} is out of date: run npm run build:widget and commit it.`);
      stale = true;
    }
  } else writeFileSync(file, content);
}
const sizes = outputs.map(([f, c]) => `${f.split("/").pop()} ${(Buffer.byteLength(c) / 1024).toFixed(1)} KB`).join(", ");
console.log(`${check ? "Checked" : "Built"}: ${sizes}`);
if (Buffer.byteLength(LOADER_JS) > LIMIT) { console.error("Loader is over the 10 KB theme check limit"); process.exit(1); }
if (stale) process.exit(1);
