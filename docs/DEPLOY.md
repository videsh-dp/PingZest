# Deploying PingZest to your own server (nginx + PM2)

About ₹530/month: a 1 GB VPS (Linode Mumbai, $5) + a domain (Cloudflare, ~₹1,000/year) +
MongoDB Atlas free tier + PostHog free. SSL is free (Let's Encrypt) and renews itself.

```
Shopify ──https──▶ nginx (SSL, gzip, rate limits) ──▶ PM2 ──▶ Node app :3000 ──▶ MongoDB Atlas
                                                                   └──────────────▶ PostHog
GitHub push ─▶ CI tests ─▶ build ─▶ upload ─▶ release.sh (install, db indexes, switch, reload, health check)
```

## 1. Accounts (once)

1. **Linode** (Akamai Cloud) → Create Linode → **Ubuntu 24.04**, region **Mumbai**, plan **Nanode 1 GB**.
   Add your SSH key or a strong root password. Note the IP address.
2. **Cloudflare** → Domain Registration → buy your domain (e.g. `pingzest.app`).
   DNS → add an **A record**: name `app` (or `@`), value = the Linode IP, proxy **DNS only (grey cloud)**.
3. **MongoDB Atlas** → free **M0** cluster, region **Mumbai (ap-south-1)** →
   Database Access: add a user → Network Access: add the Linode IP →
   Connect → Drivers → copy the `mongodb+srv://…` string and add `/pingzest` before the `?`.
4. **PostHog** → new project → copy the Project API key (`phc_…`).
5. **Shopify Partners** → Apps → create the app (or `npm run config:link` locally) → note the
   Client ID and secret. App URL will be `https://app.yourdomain.com`.

## 2. Set up the server (once, ~5 minutes)

```bash
ssh root@<linode-ip>
curl -fsSL https://raw.githubusercontent.com/videsh-dp/PingZest/main/deploy/setup-server.sh -o setup.sh
bash setup.sh app.yourdomain.com you@email.com
```

It installs Node 22, PM2 (starts on boot, log rotation), nginx, the SSL certificate, a firewall
(only SSH/HTTP/HTTPS), fail2ban, automatic security updates and 1 GB swap, and creates a `deploy`
user. At the end it prints what to paste into GitHub.

Then fill in the settings:

```bash
nano /var/www/pingzest/shared/.env
```

```
SHOPIFY_API_KEY=...            # Client ID
SHOPIFY_API_SECRET=...         # Client secret
SHOPIFY_APP_URL=https://app.yourdomain.com
SHOPIFY_APP_HANDLE=pingzest
SCOPES=read_orders,write_orders,read_fulfillments,read_discounts,write_discounts,read_locales,write_order_edits,write_merchant_managed_fulfillment_orders,write_app_proxy
DATABASE_URL=mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/pingzest?retryWrites=true&w=majority
POSTHOG_API_KEY=phc_...
POSTHOG_HOST=https://us.i.posthog.com
BILLING_TEST=true              # false when you go live
CRON_SECRET=...                # 16+ random characters: lets the server cron run the COD autopilot for quiet stores
```

## 3. Connect GitHub (once)

Repo → Settings → Secrets and variables → Actions:

| Type | Name | Value |
|---|---|---|
| Variable | `DEPLOY_HOST` | Linode IP |
| Variable | `DEPLOY_USER` | `deploy` |
| Variable | `APP_DOMAIN` | `app.yourdomain.com` |
| Secret | `DEPLOY_SSH_KEY` | the key printed by the setup script |

From now on every push to `main` runs the tests and, if they pass, deploys. Watch it under **Actions**.

## 4. Point Shopify at it

In `shopify.app.toml` set `application_url` and the `redirect_urls` to `https://app.yourdomain.com`,
then `npm run deploy` (pushes the config, webhooks and theme extension to Shopify).

## Everyday commands (on the server, as `deploy`)

```bash
pm2 status                      # is it running, memory, restarts
pm2 logs pingzest --lines 100   # live logs (errors are also in PostHog)
pm2 reload pingzest             # restart without downtime
bash /var/www/pingzest/current/deploy/release.sh --rollback   # back to the previous release
curl -s localhost:3000/healthz  # {"ok":true} when the app and MongoDB answer
```

Optional: once SSL works you can turn Cloudflare's proxy on (orange cloud) with SSL mode **Full (strict)**
for free DDoS protection and caching.

## Before real merchants: backups and monitoring

- **Backups.** Atlas M0 (free) has **no automatic backups**. Either move to M10 (Cloud Backup) once you have paying
  stores, or run a nightly `mongodump --uri "$DATABASE_URL" --gzip --archive=/var/backups/pingzest-$(date +%F).gz`
  from cron and copy it off the server. Test a restore once.
- **Uptime alert.** Add a free UptimeRobot/Better Stack check on `https://app.yourdomain.com/healthz` (it also
  checks MongoDB) with an email or phone alert.
- **COD autopilot schedule.** `setup-server.sh` adds a 15-minute cron that calls `/cron/cod` with a generated
  `CRON_SECRET`. On a server set up earlier, add `CRON_SECRET=<16+ random characters>` to `.env` and a cron line
  `*/15 * * * * curl -fsS -X POST -H "Authorization: Bearer <secret>" http://127.0.0.1:3000/cron/cod`.
- **`.env` values** may contain `&` (Atlas URLs do): the app and release script read the file safely, but never
  `source` it in a shell.
