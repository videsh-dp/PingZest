#!/usr/bin/env node
/**
 * Local development through your own ngrok domain instead of Shopify's default Cloudflare tunnel.
 *
 *   1. ngrok account (free) → Domains → claim your free static domain, e.g. pingzest-dev.ngrok-free.app
 *   2. `ngrok config add-authtoken <token>` once
 *   3. In .env:  NGROK_DOMAIN=pingzest-dev.ngrok-free.app   (optional: DEV_PORT=3000)
 *   4. npm run dev:ngrok
 *
 * Starts `ngrok http <port> --url=<domain>`, then `shopify app dev --tunnel-url https://<domain>:<port>`,
 * which points the app URL, redirect URLs, app proxy and webhooks at your ngrok domain while it runs.
 */
import { spawn, spawnSync } from "node:child_process";

try { process.loadEnvFile(); } catch { /* no .env: use the shell environment */ }

const domain = (process.env.NGROK_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const port = process.env.DEV_PORT || "3000";
if (!domain) {
  console.error("Set NGROK_DOMAIN in .env (your free static domain from the ngrok dashboard, e.g. pingzest-dev.ngrok-free.app).");
  process.exit(1);
}
const hasNgrok = spawnSync(process.platform === "win32" ? "where" : "which", ["ngrok"]).status === 0;
if (!hasNgrok) {
  console.error("ngrok isn't installed: https://ngrok.com/download (then `ngrok config add-authtoken <token>`).");
  process.exit(1);
}

const shell = process.platform === "win32";
console.log(`▶ ngrok: https://${domain} → localhost:${port}`);
const ngrok = spawn("ngrok", ["http", port, `--url=${domain}`, "--log=stdout", "--log-level=warn"], { stdio: ["ignore", "inherit", "inherit"], shell });

console.log("▶ shopify app dev (press p in the CLI to open the app in your dev store)");
const app = spawn("npx", ["shopify", "app", "dev", `--tunnel-url=https://${domain}:${port}`], { stdio: "inherit", shell });

const stop = () => { ngrok.kill(); app.kill(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
app.on("exit", (code) => { ngrok.kill(); process.exit(code ?? 0); });
ngrok.on("exit", (code) => { if (code) { console.error("ngrok stopped (is the domain right and the authtoken set?)"); app.kill(); } });
