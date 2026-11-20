# Setup guide

From zero to the app running on your own Shopify development store, then to production.
Commands assume macOS or Linux; on Windows use WSL or Git Bash.

## 1. What you need

| | Why |
|---|---|
| Node.js **20.19+** (`node -v`) | Runs the app |
| A free [Shopify Partner account](https://partners.shopify.com) | Lets you create apps and development stores |
| A development store | A free test store with no real customers |
| Git | To clone this repo |

## 2. Create a Partner account and a development store

1. Sign up at **partners.shopify.com**. You can register as an individual.
2. Open the **Dev Dashboard** (dev.shopify.com) → **Stores** → create a **development store**.
3. In that store's admin: **Settings → Payments → Manual payment methods → Cash on Delivery (COD)**.
   You need this to place test COD orders.

## 3. Get the code running

```bash
git clone https://github.com/videsh-dp/PingZest.git
cd PingZest
npm install
cp .env.example .env     # local MongoDB connection string
docker compose up -d     # starts MongoDB locally (needs Docker Desktop)
npm run config:link      # log in to Shopify; choose "create a new app" and name it
npm run setup            # creates the MongoDB collections and indexes
npm run dev              # starts the app + a secure tunnel; prints an install link
```

Open the install link and pick your development store. That's also how you **log in**: the app uses
Shopify's own sign-in, so there's no separate password. Anyone opening the app URL directly sees the
landing page, types their store address and continues to Shopify.

`npm run dev` keeps running. Leave the terminal open while you test.

> **No Docker?** Create a free cluster on [MongoDB Atlas](https://www.mongodb.com/atlas), add your IP under
> Network Access, and put its connection string (ending in `/pingzest`) in `.env` as `DATABASE_URL`.
> A plain standalone `mongod` won't work: Prisma needs a replica set.

> **If `npm install` fails** on a version, run
> `shopify app init --template=https://github.com/Shopify/shopify-app-template-react-router`
> and copy `app/`, `extensions/`, `prisma/schema.prisma`, `public/`, `shopify.app.toml` and `test/` into it.
> Then check `ApiVersion` in `app/shopify.server.js` and `api_version` in `shopify.app.toml`.

## 4. Turn on customer data (needed for the queues)

The COD, abandoned checkout and order update queues need customers' **names and phone numbers**,
which Shopify protects.

1. Dev Dashboard → **Apps** → your app → choose **Public** distribution.
2. **Settings → Access requests → Protected customer data → Manage**.
3. Select **Customer data**, and the **Name** and **Phone** fields. Paste these reasons:
   - *Customer data:* "Merchants confirm Cash on Delivery orders and send shipping updates to their customers on WhatsApp. The app reads orders and abandoned checkouts to prepare these messages."
   - *Phone:* "Needed to open a WhatsApp chat with the customer. The merchant sends each message manually."
   - *Name:* "Used to greet the customer by first name in the message."
4. Complete **Data protection details** → **Save**.

On development stores it works right away. Shopify reviews it when you submit to the App Store.

## 5. Try every feature

| Try | Where |
|---|---|
| Add your WhatsApp number | **Settings** |
| Design the chat button and discount banner, set page rules, watch the live preview | **Widgets** |
| Switch the widgets on in your theme (one time) | **Widgets** → "Turn on PingZest in your theme" |
| Add "Ask on WhatsApp", "Order on WhatsApp", "Share" buttons and the opt-in checkbox | **Widgets → Page buttons** → "Add to theme" |
| Create a discount code and show it in the banner | **Discounts**, then **Widgets → Discount banner** |
| Write several message templates with bold, lists, quotes… and preview them | **Message templates** |
| Place a COD test order, then send the confirmation to your own phone | Store checkout → **COD confirmation** |
| Tap the confirm link on your phone and watch the order get tagged | WhatsApp → `/c/…` page → Shopify **Orders** |
| See message and widget numbers | **Analytics** (Messages / Widgets) |
| Switch the app language (or let it follow your Shopify admin) | **Settings → Language** |
| Translate widget texts for each store language; preview them | Shopify **Settings → Languages** (add one), then **Widgets → Languages** |
| Translate a template with Google (needs `GOOGLE_TRANSLATE_API_KEY`) | **Message templates** → change Language → "Translate the text into…" |

## 6. Run the tests

```bash
npm test                         # 96 unit tests (no Shopify needed)
npx playwright install chromium  # once
npm run test:widgets             # 20 browser checks of the storefront widgets
```

## 7. Deploy to production

The app needs an always-on Node.js server and a MongoDB database. Render, Railway and Fly.io all work
for the server; use MongoDB Atlas for the database. Pick the same region for both (Atlas and Fly.io both
have Mumbai) if most of your merchants are in India.

1. **Database:** create an Atlas cluster → Database Access (add a user) → Network Access (allow your host's
   IPs, or 0.0.0.0/0 with a strong password) → Connect → copy the `mongodb+srv://…` string and add
   `/pingzest` before the `?`. `npm run docker-start` runs `prisma db push` on boot to create indexes.
2. **Create the service** from your GitHub repo:
   - Build command: `npm install && npm run build`
   - Start command: `npm run docker-start`
3. **Environment variables:**

   | Name | Value |
   |---|---|
   | `SHOPIFY_API_KEY` | Client ID (Dev Dashboard → your app) |
   | `SHOPIFY_API_SECRET` | Client secret |
   | `SHOPIFY_APP_URL` | Your server's public URL, e.g. `https://pingzest.onrender.com` |
   | `SCOPES` | `read_orders,write_orders,read_discounts,write_discounts,read_locales,write_order_edits` |
   | `DATABASE_URL` | Your MongoDB Atlas connection string, ending in `/pingzest?...` |
   | `NODE_ENV` | `production` |
   | `BILLING_TEST` | `true` while testing; `false` once the app is public, to take real payments |
   | `SHOPIFY_APP_HANDLE` | Your app's handle (Partner Dashboard → App setup → URL), used to return merchants to the Plan page after paying |
   | `POSTHOG_API_KEY` | Optional but recommended. PostHog → Project settings → Project API key (`phc_…`). Logs every request, error and API call, and powers feature flags |
   | `POSTHOG_HOST` | `https://us.i.posthog.com` (or `https://eu.i.posthog.com` for an EU project) |
   | `GOOGLE_TRANSLATE_API_KEY` | Optional. Shows the "Auto-translate" / "Translate" buttons. Google Cloud → enable *Cloud Translation API* → Credentials → API key (restrict it to that API) |

4. In `shopify.app.toml` set `application_url`, `redirect_urls` and `[app_proxy] url` to your server URL,
   then run `npm run deploy`. That publishes the config, webhooks and the theme app extension.
5. Open the app from your dev store again to check everything works on the production URL.

## 8. Submit to the Shopify App Store

Work through [APP_STORE_CHECKLIST.md](APP_STORE_CHECKLIST.md). Use
[PRIVACY_POLICY_TEMPLATE.md](PRIVACY_POLICY_TEMPLATE.md) for your privacy policy (have it reviewed first).

## Troubleshooting

| Problem | Fix |
|---|---|
| Queues show "No phone" | Protected customer data isn't saved yet (step 4), or the order has no phone. Make phone required at checkout: Settings → Checkout. |
| Widgets don't appear in the store | Turn on the **PingZest widgets** app embed in the theme editor, and press **Save** in Widgets at least once. |
| "Saved in the app, but your store didn't update" | The metafield sync failed. Save again; check the terminal for the error. |
| Confirm links stop working after restarting `npm run dev` | The dev tunnel URL changes on every restart. Production URLs don't. |
| Discount "Apply" does nothing | The code must exist and be active in Shopify (Discounts page shows its status). |
| Widget clicks stay at 0 | Tracking needs the app proxy; check `[app_proxy]` in `shopify.app.toml` and run `npm run deploy`. |
