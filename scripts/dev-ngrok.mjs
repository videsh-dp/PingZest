#!/usr/bin/env node
/**
 * Local development through your own ngrok domain instead of Shopify's default Cloudflare tunnel.
 *
 *   1. ngrok account (free) → Domains → claim your free static domain, e.g. pingzest-dev.ngrok-free.app
 *   2. `ngrok config add-authtoken <token>` once
 *   3. In .env:  NGROK_DOMAIN=pingzest-dev.ngrok-free.app   (optional: DEV_PORT=3000)
 *   4. npm run dev:ngrok
 *
 * Already running ngrok yourself (e.g. as a Windows service or another terminal)? Set NGROK_START=false
 * and point it at the same port: `ngrok http 8080 --url=<domain>` with DEV_PORT=8080.
 *
 * Starts `ngrok http <port> --url=<domain>`, then `shopify app dev --tunnel-url https://<domain>:<port>`,
 * which points the app URL, redirect URLs, app proxy and webhooks at your ngrok domain while it runs.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

try { process.loadEnvFile(); } catch { /* no .env: use the shell environment */ }

const domain = (process.env.NGROK_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const port = process.env.DEV_PORT || "3000";
if (!domain) {
  console.error("Set NGROK_DOMAIN in .env (your free static domain from the ngrok dashboard, e.g. pingzest-dev.ngrok-free.app).");
  process.exit(1);
}
const startNgrok = !/^(false|0|no)$/i.test(process.env.NGROK_START || "true");
const shell = process.platform === "win32";
let ngrok = null;
if (startNgrok) {
  const hasNgrok = spawnSync(shell ? "where" : "which", ["ngrok"]).status === 0;
  if (!hasNgrok) {
    console.error("ngrok isn't installed: https://ngrok.com/download (then `ngrok config add-authtoken <token>`), or set NGROK_START=false if it runs elsewhere.");
    process.exit(1);
  }
  console.log(`▶ ngrok: https://${domain} → localhost:${port}`);
  ngrok = spawn("ngrok", ["http", port, `--url=${domain}`, "--log=stdout", "--log-level=warn"], { stdio: ["ignore", "inherit", "inherit"], shell });
  ngrok.on("exit", (code) => { if (code) { console.error("ngrok stopped (is the domain right, the authtoken set, and no other ngrok using it?)"); app?.kill(); } });
} else {
  console.log(`▶ Using your running ngrok: https://${domain} → localhost:${port}`);
}

console.log("▶ shopify app dev (press p in the CLI to open the app in your dev store)");
// Until the app is approved for protected customer data, Shopify refuses the order/checkout/fulfillment
// webhook topics, so local runs use shopify.app.local.toml (without them). `-- --full` uses the main config.
const full = process.argv.includes("--full");
const configArgs = full || !existsSync("shopify.app.local.toml") ? [] : ["--config", "local"];
console.log(full ? "  (main config: all webhook topics)" : "  (local config: no order/checkout/fulfillment webhooks; use npm run test:webhooks)");
var app = spawn("npx", ["shopify", "app", "dev", ...configArgs, `--tunnel-url=https://${domain}:${port}`], { stdio: "inherit", shell });

const stop = () => { ngrok?.kill(); app.kill(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
app.on("exit", (code) => { ngrok?.kill(); process.exit(code ?? 0); });
