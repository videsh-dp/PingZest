# Run PingZest on your laptop (with ngrok)

Your laptop runs the app; ngrok gives it a public HTTPS address so Shopify can load it in the
admin and send webhooks to it. Nothing to buy: ngrok's free plan includes one static domain.

## Once

1. **Node 22** (https://nodejs.org) and **Git**.
2. **MongoDB**, either:
   - Docker Desktop, then `docker compose up -d` in the project folder (one-node replica set), or
   - a free MongoDB Atlas cluster (allow your IP under Network Access).
3. **ngrok**: sign up (free) → *Domains* → claim your free static domain → install ngrok →
   `ngrok config add-authtoken <your token>`.
4. Get the code and install:
   ```bash
   git clone https://github.com/videsh-dp/PingZest.git && cd PingZest
   git checkout dev
   npm install
   cp .env.example .env
   ```
5. In `.env` set:
   ```
   DATABASE_URL="mongodb://localhost:27017/pingzest?replicaSet=rs0&directConnection=true"   # or your Atlas URL
   NGROK_DOMAIN=your-name.ngrok-free.app
   SHOPIFY_API_SECRET=...      # the app's Client secret (only used by the test-webhook script)
   ```
6. `npm run setup` (creates the collections and indexes).

## Every time

```bash
npm run dev:ngrok
```

- Starts ngrok on your domain (or uses yours: `NGROK_START=false`) and `shopify app dev` with a generated, git-ignored `shopify.app.ngrok.toml` (the local config with every `https://example.com` replaced by your ngrok domain, so the app page never shows example.com)
  (log in to Shopify the first time; it asks for the dev store's storefront password once:
  *Online Store → Preferences → Password protection*).
- `shopify.app.local.toml` is the same app without the order/checkout/fulfillment webhooks: Shopify refuses
  those topics until the app is approved for protected customer data. Use `npm run test:webhooks` for them.
  After approval, `npm run dev:ngrok -- --full` uses the main config with all webhooks.
- While it runs, the app URL, redirect URLs, app proxy and **webhooks** point at your ngrok domain.
- Press **p** in the terminal to open the app in `golibar-mrv1ujxf.myshopify.com` (approve the install the first time).
- The storefront widgets come from the theme extension: in the dev store, *Online Store → Themes → Customize →
  App embeds* → turn on **PingZest**.
- Code changes reload automatically. Ctrl+C stops everything (the URLs go back to the config file's values).

## Test data in one command

Real dev-store orders arrive with customer names and phones hidden until the app has customer-data
access (needs the $19 App Store registration). To test the queues today, send realistic signed webhooks:

```bash
npm run test:webhooks            # 4 orders (one high-risk), 2 abandoned checkouts, 1 shipped, 1 delivered
npm run test:webhooks -- --privacy   # also a data request (check the ComplianceRequest collection)
```

It prints confirm-page links you can open on your phone. Then check, in the app:
COD confirmation (incl. Send on WhatsApp → opens WhatsApp with the message), Abandoned checkouts,
Order updates, Analytics. Messages open WhatsApp with test numbers (+91 90000 0000x), so don't press send.

You can also fire Shopify's own sample payloads:
`npx shopify app webhook trigger --topic orders/create --address https://your-name.ngrok-free.app/webhooks/orders`

## Things to know

- **ngrok's warning page:** free ngrok shows a one-time "You are about to visit…" page to browsers. Webhooks
  aren't affected. If it gets in the way inside the Shopify admin, click *Visit Site* once, or run plain
  `npm run dev`, which uses Shopify's own Cloudflare tunnel (no warning page, new URL each run, webhooks still work).
- **Billing:** the Pro upgrade needs the app to have Public distribution; until then the Plan page shows but
  starting a trial fails.
- **PostHog:** optional locally. Add `POSTHOG_API_KEY` to `.env` to see your local requests and errors there.
- **Branch:** work on `dev`. Pushes to `dev` run all cloud tests; only `main` deploys to the server.

## The app page shows "This domain is for use in documentation examples"

That's example.com: Shopify loaded the placeholder URL instead of your ngrok domain. Stop the run, `git pull`,
and start `npm run dev:ngrok` again (it now writes the ngrok URLs into `shopify.app.ngrok.toml`). If it still
shows, release that config once: `npx shopify app deploy --config ngrok` (the app is unlisted, so only your dev
store sees it), then reload the app page.

## Checklist on your dev store

CI already runs every feature end to end against a fake Shopify (see README → Cloud tests). These are the parts only
your real store can show, about 10 minutes:

1. **Open the app** from your admin (Apps → PingZest). You see Home and the left sidebar; every link opens its page.
2. **Settings:** set the store name and your WhatsApp number, then Save.
3. **Widgets:** turn on the chat button and press Save. Click **Turn on in theme** (opens the theme editor with the
   PingZest embed), save the theme, then open your storefront: the chat button shows.
4. **Test data:** in a second window, `npm run test:webhooks`. COD confirmation, Abandoned checkouts and Order
   updates fill up. Open a COD order's confirm link from the script output on your phone and tap Confirm.
   Order tags appear in Shopify only for real orders (the test orders don't exist in your store).
5. **Discounts:** create `TEST10`. It appears in Shopify admin → Discounts.
6. **Plan:** Upgrade → Shopify's approval page (a test charge on a dev store, nothing is billed) → Approve.
   The app shows Pro. Cancel goes back to Free.
7. **A real COD order:** place one on your storefront with Cash on Delivery. Once Shopify approves protected
   customer data, it arrives by itself (`npm run dev:ngrok -- --full`); until then use `npm run test:webhooks`.

Storefront script: edit `widget-src/wa-widget.js`, then `npm run build:widget` (the theme loads the built files).
