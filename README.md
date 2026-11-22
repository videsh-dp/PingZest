# PingZest: free plan

[![CI](https://github.com/videsh-dp/PingZest/actions/workflows/ci.yml/badge.svg)](https://github.com/videsh-dp/PingZest/actions/workflows/ci.yml)

WhatsApp widgets, COD confirmation, abandoned checkout reminders and order updates for Shopify.
**Manual send:** the app prepares every message and opens WhatsApp with it typed in; the merchant
presses send. There's no Meta API, no Meta business verification and no per-message fees.

![Widgets editor](docs/screenshots/widgets-editor.png)

**New here?** Follow the step-by-step **[setup guide](docs/SETUP.md)**: Partner account → dev store → running app → production.

## What's in the free plan

| Area | Feature | Needs |
|---|---|---|
| **Widgets editor** | Design every widget in the app with a **live preview** (the real storefront script in an iframe), desktop/mobile toggle and page switcher | – |
| Chat button | Shape (pill / circle / rounded), size, colours, icon, pulse, "Need help?" tooltip, popup header colour, up to 5 agents, business hours | – |
| Chat button | Placement **per device**: side, distance from side/bottom, show/hide, icon-only on mobile; lifts above bottom banners automatically | – |
| **Discount banner** | Top bar / bottom bar / floating card / popup; colours, accent, shape, size; show-after delay; dismiss remembered for N days | – |
| Discount banner | **Apply** adds the code to the cart (`/discount/CODE`), **Copy** copies it; shows "✓ Applied" afterwards | – |
| **Discounts** | Create % or fixed-amount codes in Shopify from the app (min. order, end date, once per customer); pause / delete | `write_discounts` |
| **Page rules** | Every widget: all pages / only on… / all except…, by page type (home, product, collection, cart, search, pages, blog…) or URL patterns (`/products/*`) | – |
| Page buttons | "Ask on WhatsApp", "Order on WhatsApp" (cart items + total + cart link), "Share on WhatsApp": styled from the app | Theme app blocks |
| Storefront | WhatsApp opt-in checkbox on the cart (saved on the order as consent) | – |
| **Widget analytics** | Views, clicks, click rate per widget; clicks per day (7/30/90 days); mobile vs desktop; by page; discount funnel → orders and sales from your codes | App proxy |
| **Login** | Merchants sign in with their **Shopify account** (OAuth / token exchange). Public landing + "Log in with Shopify" page, staff name shown, sign-out | – |
| Admin | Dashboard, setup checklist, one-click theme editor links | – |
| Admin | **COD confirmation queue** → Send / Waiting / To remind / Confirmed / Cancelled / No reply | Level 2 customer data |
| **COD follow-up** | Optional **fulfillment hold** on new COD orders, released on confirm; **reminder** list after X hours (own reminder template); **expire** after Y hours with a no-reply tag; one-click **cancel + restock in Shopify** for cancelled / unanswered orders; failed Shopify actions shown on the order with Retry | `write_merchant_managed_fulfillment_orders`, `write_orders` |
| Admin | Abandoned checkout queue and order updates queue (shipped / delivered) | Level 2 customer data |
| **Templates** | A built-in Standard template for every stage and language, plus **5 custom templates on the Free plan** (unlimited on Pro), one default per stage and language; formatting toolbar for what typed WhatsApp messages support (bold, italic, strikethrough, monospace, inline code, quote, lists), emoji, variables; phone-style preview rendered like WhatsApp; starter templates | – |
| Queues | Template picker on each queue: switch templates and the messages update instantly | – |
| **Saved on returns** | Home, Plan and Analytics → Returns show the money COD confirmation saved: COD orders cancelled or unanswered and not shipped, plus orders paid online, × the merchant's average cost of a returned parcel (Settings → Orders; ₹500 by default for INR stores). "Returned (RTO)" mark on COD orders | – |
| **Message analytics** | Messages sent per day and by stage, COD confirm/cancel rate, median reply time, checkout recovery rate and sales, **template performance** | – |
| Public | `/c/:token` confirm page: customer taps Confirm/Cancel → order tagged in Shopify | – |
| **Languages** | Admin in **7 languages** (English, हिन्दी, Español, Português (Brasil), Français, Deutsch, العربية with right-to-left layout). Follows the Shopify admin language, or pick one in Settings. Numbers, money, dates and plurals use the built-in `Intl` library | – |
| Languages | Storefront widgets speak the **shopper's language**: built-in labels and untouched default texts in all 7 languages, plus your own per-language texts (Widgets → Languages) for every store language | `read_locales` |
| Languages | Default message templates in all 7 languages; confirm page in the customer's language (message language → browser → shop default) | – |
| Languages | Optional **Google Translate** drafts: "Auto-translate empty fields" for widget texts, "Translate the text into…" for templates. `{variables}`, links and WhatsApp formatting are protected. Nothing is translated on page load | `GOOGLE_TRANSLATE_API_KEY` (optional) |
| Compliance | `customers/data_request`, `customers/redact`, `shop/redact` webhooks | Required for the App Store |

Screenshots: [login](docs/screenshots/login.png) · [templates](docs/screenshots/templates.png) ·
[message analytics](docs/screenshots/analytics-messages.png) · [widgets editor](docs/screenshots/widgets-editor.png) · [storefront](docs/screenshots/storefront-desktop.png) ·
[another design](docs/screenshots/storefront-design-variant.png) · [mobile](docs/screenshots/storefront-mobile.png) ·
[analytics](docs/screenshots/analytics.png) · [discounts](docs/screenshots/discounts.png) · [COD queue](docs/screenshots/cod.png) ·
[templates](docs/screenshots/templates.png) · [confirm page](docs/screenshots/confirm.png) ·
[analytics in Spanish](docs/screenshots/analytics-es.png) · [templates in Arabic](docs/screenshots/templates-ar.png) ·
[storefront in Arabic](docs/screenshots/storefront-ar.png) · [confirm page in Arabic](docs/screenshots/confirm-ar.png) ·
[Plan page](docs/screenshots/plan.png) · [COD risk score](docs/screenshots/cod-risk.png) · [confirm page with Pro](docs/screenshots/confirm-pro.png)

## How widget settings reach the store

1. The merchant edits widgets in **Widgets** and presses Save.
2. The app validates the settings (`app/lib/widget-config.js`), stores them, and writes them to an
   **app-owned metafield** (`pingzest.config`) with `metafieldsSet`.
3. The theme app embed (`blocks/app-embed.liquid`, one switch in the theme editor) prints that JSON with
   `{{ app.metafields.pingzest.config.value | json }}` plus the page type, so the storefront script needs
   no network request to load settings.
4. The storefront script builds the chat button and banner, applies page rules, styles the page buttons,
   and sends **one** analytics request per page for views (plus one per click) to the app proxy.
   Edit the readable source in `widget-src/wa-widget.js`, then run `npm run build:widget`: it writes the
   minified `assets/wa-widget-core.js` and the 0.5 KB `assets/wa-widget.js` loader that the theme blocks
   include (Shopify's theme check limits app block JavaScript to 10 KB). CI fails if you forget to rebuild.

## How the COD flow works

1. A COD order arrives (`orders/create` webhook). The app saves it with a random, expiring confirm token.
2. In **COD confirmation**, the merchant clicks **Send on WhatsApp**. WhatsApp opens with:
   > Hi Priya, thank you for shopping with Kurta House! … Please tap to confirm or cancel your order:
   > https://your-app.com/c/Ab3dE5fG7hJ9
3. The link shows a preview card that looks like buttons (`public/og-confirm.png`).
4. The customer taps it and chooses **Confirm** or **Cancel**. The order gets the `wa-cod-confirmed` or
   `wa-cod-cancelled` tag in Shopify, and the queue updates.
5. **Follow-up** (Settings → Orders → COD follow-up, `app/models/cod-loop.server.js`):
   - **Hold fulfillment** (opt-in): new COD orders are put on hold in Shopify (`fulfillmentOrderHold`) so nobody
     ships them by mistake; the hold is released when the order is confirmed (customer, merchant or paid online).
   - **To remind**: orders sent more than 24 h ago (setting) without a reply. "Send reminder" opens WhatsApp with the
     *COD reminder* template.
   - **Expire** after 72 h (setting): "Expire now" moves the order to No reply and adds the `wa-cod-no-reply` tag.
   - **Cancel in Shopify**: one click cancels a cancelled or unanswered order in Shopify (`orderCancel`, restock on by
     default, the customer isn't emailed). Shipped and paid orders are never cancelled.
   - **Pro autopilot** (opt-in): expire automatically, and cancel + restock automatically when the customer cancels or
     the order expires. There's no worker process: due work runs on COD webhooks and when the app opens (at most every
     10 minutes per shop). For quiet stores, call `POST /cron/cod` with `Authorization: Bearer $CRON_SECRET` from any
     scheduler (e.g. hourly cron on the server: `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-app/cron/cod`).

## Languages

- **Admin text** is written in English in the code (`tr("Save changes")`) and looked up in
  `app/i18n/locales/<lang>.json`. A missing translation falls back to English, so nothing breaks.
- **Which language:** Settings → App language. "Same as my Shopify admin" uses the `locale` Shopify sends
  when the app opens, then the browser language.
- **Storefront:** the theme passes `request.locale` to the widget. Built-in labels and default texts are
  translated in `wa-widget.js` and `extensions/pingzest-widgets/locales/*.json`; anything the merchant wrote stays as
  written unless they add a translation under Widgets → Languages.
- **Google Translate is optional and only runs when a merchant clicks a translate button.** Set
  `GOOGLE_TRANSLATE_API_KEY` (Google Cloud → APIs → Cloud Translation API → Credentials) to show the buttons.
  Google charges per character after its free monthly allowance; a full widget translation is about 1,000 characters.

**Add a language** (e.g. Japanese):

```bash
GOOGLE_TRANSLATE_API_KEY=... node scripts/translate-locale.mjs ja   # drafts app/i18n/locales/ja.json
```

Then add `ja` to `LOCALES` in `app/i18n/core.js` and to `app/i18n/dictionaries.js`, add confirm-page texts in
`app/i18n/confirm.js`, default templates in `app/lib/templates.js`, and storefront texts in `wa-widget.js` and
`extensions/pingzest-widgets/locales/ja.json`. Have a native speaker review the drafts. `npm test` fails until every
string is translated (`node scripts/extract-i18n.mjs --check` lists what's missing).

## Local development

Run it on your laptop with ngrok and fill it with test data: see **[docs/LOCAL_DEV.md](docs/LOCAL_DEV.md)**
(`npm run dev:ngrok`, `npm run test:webhooks`). Work on the `dev` branch; `main` deploys.

## Deploying

Own server with nginx + PM2 (about ₹530/month): see **[docs/DEPLOY.md](docs/DEPLOY.md)**. One setup script for a fresh
Ubuntu server, then every push to `main` that passes the tests deploys automatically (with health check and rollback).

## Cloud tests (GitHub Actions)

Every push runs `.github/workflows/ci.yml` on GitHub (free for public repos):

1. Install, then `prisma validate` / `generate` / `db push` against a real **MongoDB replica set**
2. Unit tests, translation coverage, **production build** (catches server-only code leaking into the browser bundle)
3. **Integration tests** (`test/integration/server.test.mjs`): starts the production server and calls it the way Shopify
   does: HMAC-signed webhooks (orders, paid, plan changes, privacy), the confirm page (view + Confirm), public pages.
   A fake PostHog server checks that every request is logged and that phone numbers and addresses never leave.
4. **End-to-end tests** (`test/e2e/`): the app against a **fake Shopify** (`test/e2e/fake-shopify.mjs`) that it
   reaches over HTTPS at `https://e2e-store.myshopify.com`, exactly like the real one (CI points that hostname at
   the fake and trusts its certificate). Embedded login with session tokens and token exchange, every admin page
   in several languages, every form action (settings, templates and the Free limit, discounts, widgets, COD,
   abandoned checkouts, order updates, plan upgrade and cancel), webhooks feeding the queues, the confirm page
   (confirm, address fix, pay online with the order-edit discount), app proxy beacons with Shopify's signature.
   The fake checks **every Admin API query and its variables against Shopify's real Admin schema**
   (`scripts/fetch-admin-schema.mjs`), so a wrong field name fails here, not on a merchant's store.
   The same suite runs again on the **Vite dev server** (what `shopify app dev` runs locally).
5. **Browser end-to-end** (`test/e2e/browser.test.mjs`): Chromium clicks through every page from the left sidebar
   with a stand-in for App Bridge, saves Settings from the form, checks the phone menu, confirms an order on the
   confirm page; fails on any page, hydration or console error. Screenshots are kept as a build artifact.
6. **Browser tests** of the storefront widgets (Playwright + Chromium).

Not covered (needs a real store): Shopify's own screens (the billing approval page, the theme editor) and the
real App Bridge inside Shopify admin. See docs/LOCAL_DEV.md → "Checklist on your dev store".

## Logging, errors and feature flags (PostHog)

Set `POSTHOG_API_KEY` (Project settings → Project API key, `phc_…`) and `POSTHOG_HOST`
(`https://us.i.posthog.com` or `https://eu.i.posthog.com`). Without a key nothing is sent and flags use their defaults.
No npm package is needed: `app/lib/posthog-client.js` talks to PostHog's HTTP API directly.

| Event | When | What's in it |
|---|---|---|
| `api_request` | Every request: admin pages, data loads, form posts, webhooks, storefront calls, confirm page | method, path, kind, shop, status, `level` (info/warning/error), duration, query + form params, JSON responses, redirect target, webhook topic/id, `request_id` |
| `shopify_api_call` | Every Admin GraphQL call | operation, duration, status, GraphQL errors, `userErrors`, query cost, variables and response data |
| `external_api_call` | Google Translate | service, target language, duration, ok/error |
| `$exception` | Errors in loaders/actions/rendering, failed API calls, crashes, browser JavaScript errors | stack trace, path, shop, `request_id` (shows in PostHog **Error tracking**) |
| `privacy_data_request` … | Privacy webhooks | request id and summary only |
| `$pageview`, `$autocapture` | Browser, admin app only | pages and clicks (text masked) |

- **Find a request:** Activity → filter `api_request` by `status ≥ 500`, `path`, or a shop. Filter any event by `request_id`
  to see everything one request did.
- **Never sent:** customer names, phones, emails, addresses, tokens, HMACs, cookies, confirm-link tokens, webhook
  payloads. `app/lib/telemetry.js` removes them (tested). Session recording is off and clicked text is masked.
- **Free plan volume (1M events/month):** an admin page view is 2–4 events. The storefront click counter runs on
  every shopper page view, so successful storefront calls are sampled at 1% (`POSTHOG_STOREFRONT_SAMPLE=0.01`);
  failures are always logged.
- **Alerts:** in PostHog create an alert on `$exception` count, and on `privacy_data_request` (see below).

**Feature flags:** defined in `app/lib/flags.js` with a default each. Create a flag with the same key in PostHog to
roll it out to some stores (by shop domain, plan or %). Flags are read on the server per shop (cached 60 s), so pages
render with the right features, and are available in components with `useFlag("key")` and in loaders with
`flagOn(shop, "key")`. Current flags: `google-translate`, `widget-languages-tab`, `template-performance`.

## Plans and billing

Prices and features are in `app/lib/plans.js`; Shopify bills the merchant on their Shopify invoice (Billing API).

| | Free | Pro — $9.99/month or $99/year, 7-day trial |
|---|---|---|
| Widgets, COD queue, cart and order messages, analytics, 7 languages | ✓ | ✓ |
| Custom message templates (Standard templates always included) | 5 | Unlimited |
| **COD risk score** (Low / Medium / High with reasons; filter; Shopify tag) | count only | ✓ |
| **COD → prepaid** (confirm page: "pay online now and save X%") | – | ✓ |
| **Address check** (confirm page: customer fixes the address or adds a landmark) | – | ✓ |
| **COD follow-up**: fulfillment hold, reminders, expire, cancel + restock in Shopify | by hand | ✓ + **autopilot** |
| **Saved on returns** headline (Home, Plan, Analytics) | ✓ | ✓ |
| **Returns insights**: cancel / no-reply / RTO rates by PIN code, first-time vs repeat buyer, coupon, order hour; confirmed vs unconfirmed RTO; CSV export | – | ✓ |
| "Powered by PingZest" in the chat popup | shown | hidden |

- **Plan page** (`/app/plan`): compare, start the trial (Shopify's approval page), cancel.
- **Staying in sync:** `app_subscriptions/update` webhook plus a check at most every 10 minutes when the app opens.
  FROZEN (payment failed), cancelled or expired → Free; widgets are re-published so the branding line follows the plan.
- **Test charges:** on until `BILLING_TEST=false`. Development stores can only approve test charges.
- **Return URL** after approval uses `SHOPIFY_APP_HANDLE` (the app's handle in the Partner Dashboard, default `pingzest`).
- **Upgrade a store by hand** (e.g. a friend's store): set `plan: "pro"` on its `ShopSettings` in MongoDB. The next
  billing check moves it back to Free if it has no subscription, so for a permanent comp give it a 100% discount in
  the Partner Dashboard instead.

### COD money-savers (Pro)

- **Risk score** (`app/lib/risk.js`): scored when a COD order arrives (all plans, so it's ready on upgrade). Signals:
  earlier cancellations / no replies / confirmations from the same phone, several orders from one number in 24 h,
  PIN code cancellation rate (from 5 orders), order value vs the store's median (from 10 orders), and address checks
  (too short, no house number, fake/test words, invalid PIN, fake name). High ≥ 60, Medium ≥ 30. Only the PIN code and
  yes/no flags are stored, never the address.
- **COD → prepaid** (`app/lib/prepaid.js`): the confirm page offers online payment when the order is unpaid, unshipped
  and Shopify has a payment link for it. Tapping it applies the discount as an order edit (items only, capped by the
  maximum) and redirects to Shopify's own payment page for that order. `orders/paid` marks it converted, confirms it,
  and adds the tag. Needs an online payment method in the store and the `write_order_edits` scope.
- **Address check:** the confirm page reads the address live from Shopify and lets the customer change the street lines,
  city and PIN code (`orderUpdate`).
- Settings → **COD money-savers (Pro)**: risk tag, prepaid on/off, discount %, maximum, tag, address check on/off.

## Privacy requests

Shopify's three privacy webhooks are stored in the `ComplianceRequest` collection. A **data request** is saved as
`status: "pending"` together with everything PingZest holds about that customer (`data`), and sends a
`privacy_data_request` event to PostHog. Within 30 days, email `data` to the store owner, then set
`status: "done"`. (`pendingDataRequests()` and `markDataRequestSent()` in `app/models/compliance.server.js` are
ready for an automatic email later.) Redact requests delete the data and are logged as `done`.

## How login works

- **Inside Shopify admin** (the normal case): Shopify signs the merchant in automatically with
  token exchange. Installing the app is the first login.
- **Opening the app URL directly:** a landing page asks for the store address (`your-store`,
  `your-store.myshopify.com` or an admin URL all work) and sends the merchant to Shopify to sign in or install.
- **Who's signed in:** online tokens identify the staff member, shown on the dashboard and in Settings → Account.
  An offline token, stored at install, powers webhooks and the public confirm page.
- **Sign out** removes that staff member's session; the store's offline token stays.

## Run it locally

Stack: **Node.js** (React Router, Shopify's app template) + **MongoDB** through Prisma.

Requirements: Node 20.19+, MongoDB (Docker for local, or a free MongoDB Atlas cluster),
a [Shopify Partner account](https://partners.shopify.com), and a development store.

```bash
npm install
cp .env.example .env     # DATABASE_URL points at the local MongoDB below
docker compose up -d     # local MongoDB (one-node replica set, which Prisma needs)
npm run config:link      # links shopify.app.toml to your app in the Partner Dashboard
npm run setup            # prisma generate + prisma db push (creates collections and indexes)
npm run dev              # shopify app dev: tunnel, install on your dev store, live reload
```

Then, in your dev store:
1. Open the app → **Settings** → add your WhatsApp number.
2. **Widgets** → add your number, design the chat button, Save. Then click **Turn on PingZest in your theme** (one switch).
3. Place a test order with the **Cash on Delivery** payment method (Settings → Payments → Manual payment methods).
4. Open **COD confirmation** and send it to your own phone.

### If `npm install` complains about versions

Package versions were pinned without being installed here. If anything fails to resolve, generate a fresh
template and copy this project's files into it:

```bash
shopify app init --template=https://github.com/Shopify/shopify-app-template-react-router
# then copy: app/, extensions/, prisma/schema.prisma, public/, shopify.app.toml, test/
```

Also check `ApiVersion` in `app/shopify.server.js` and `api_version` in `shopify.app.toml` match the newest version your packages support.

## Tests

```bash
npm test                 # 96 unit tests: phone cleanup, templates (picking, validation), WhatsApp
                         # formatting, links, order parsing, tokens, widget settings, page rules,
                         # discount form, message analytics, store-address login input, languages
                         # (every string translated, placeholders and plurals intact, Intl formatting),
                         # PostHog logging (redaction, batching, flags, request middleware), plan limits
npm run test:e2e         # end-to-end against a fake Shopify (needs the CI setup: see ci.yml)
npm run test:e2e:browser # the same in Chromium: sidebar, every page, forms, confirm page
npm run test:widgets     # 20 browser checks of the storefront: designs, mobile, page rules, banner,
                         # copy/apply, tracking, shopper language and right-to-left (needs `npx playwright install chromium`)
```

## Project layout

```
app/lib/            Pure logic, unit-tested (phone, templates, whatsapp-format, compose, orders, tokens,
                    widget-config, discounts, preview, message-stats, shop)
app/i18n/           core.js (languages, tr(), Intl formatting) · react.jsx (useT) · locales/*.json · confirm.js
app/models/         Database + Shopify Admin API helpers (*.server.js)
app/routes/         app.* = admin pages (widgets, discounts, analytics, cod, carts, updates, templates, settings)
                    webhooks.* · proxy.track · c.$token (public confirm page)
app/components/     ui.jsx (admin UI kit, WhatsApp bubble, template picker) · fields.jsx (editor controls)
                    DailyChart.jsx (SVG chart) · Landing.jsx (login page)
extensions/pingzest-widgets/ Theme app extension: app embed (chat + banner) + product/cart/share/opt-in blocks
prisma/schema.prisma   MongoDB collections: sessions, settings, templates, orders, checkouts, widget counters
docker-compose.yml     Local MongoDB (one-node replica set)
scripts/            extract-i18n.mjs (list/check UI strings) · translate-locale.mjs (Google draft of a new language)
docs/               SETUP.md, App Store checklist, privacy policy template, screenshots
```

## Going to production

- **Database:** create a MongoDB Atlas cluster (the free M0 tier is fine to start; Atlas is always a replica set).
  Set `DATABASE_URL` to its connection string **with the database name**, e.g.
  `mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/pingzest?retryWrites=true&w=majority`.
  `npm run setup` runs `prisma db push`, which creates the collections and indexes (MongoDB has no migrations).
- **Hosting:** any Node host (Render, Railway, Fly.io). Set `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`,
  `SHOPIFY_APP_URL`, `SCOPES`, `DATABASE_URL` (and optionally `GOOGLE_TRANSLATE_API_KEY`), then run `npm run build && npm run docker-start`.
- **Deploy config and the theme extension:** `npm run deploy`.
- Before submitting, work through [docs/APP_STORE_CHECKLIST.md](docs/APP_STORE_CHECKLIST.md).

## Rules this app follows on purpose

- **Never automates WhatsApp Web.** Every message is sent by a person pressing send. Scripted sending
  breaks WhatsApp's terms and gets numbers banned.
- **No Meta API in the free plan.** Automated sending with real buttons can come later as a paid plan
  (Meta Cloud API with "coexistence", Tech Provider model, merchants pay Meta directly).
- **Stores as little shopper data as possible:** first name, phone, order summary. Click tracking keeps only daily counts.
- **Consent:** the opt-in checkbox is unchecked by default, and cart reminders are limited to one per checkout.

## Known gaps (to do before launch)

- **New scope (Nov 2026): `write_merchant_managed_fulfillment_orders`** for the COD fulfillment hold. Existing installs
  are asked to approve it the next time they open the app; until then a hold fails and shows on the order as an alert.
  Stores that fulfil only from third-party fulfillment-service locations would also need `write_third_party_fulfillment_orders` (not requested).

- `customers/data_request` currently logs the data; send it to the merchant by email before launch.
- The "Turn on" checklist steps can't detect whether the embed or blocks are enabled (needs the theme API).
- Discount "orders" count any order that used one of the app's codes (from any channel), not only shoppers who clicked the banner.
- Upgrading from the first version: the old `chat-button` block is replaced by the `app-embed` embed; re-enable it once in the theme editor.
- Delivered status relies on `fulfillments/update` with `shipment_status = delivered`, which only some couriers send. Merchants can also mark delivered by hand.
- The admin uses a small custom UI kit; swap to Polaris web components if you go for the Built for Shopify badge.
- Wix version: the logic in `app/lib/` is platform-neutral and can be reused.

## License

No license file is included yet, so by default all rights are reserved. Add one (e.g. MIT) if you want others to reuse the code.
