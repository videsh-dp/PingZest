# PingZest: free plan

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
| Admin | **COD confirmation queue** → Send / Waiting / Confirmed / Cancelled / No reply | Level 2 customer data |
| Admin | Abandoned checkout queue and order updates queue (shipped / delivered) | Level 2 customer data |
| **Templates** | A built-in Standard template for every stage and language, plus **5 custom templates on the Free plan** (unlimited on Pro), one default per stage and language; formatting toolbar for what typed WhatsApp messages support (bold, italic, strikethrough, monospace, inline code, quote, lists), emoji, variables; phone-style preview rendered like WhatsApp; starter templates | – |
| Queues | Template picker on each queue: switch templates and the messages update instantly | – |
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
[storefront in Arabic](docs/screenshots/storefront-ar.png) · [confirm page in Arabic](docs/screenshots/confirm-ar.png)

## How widget settings reach the store

1. The merchant edits widgets in **Widgets** and presses Save.
2. The app validates the settings (`app/lib/widget-config.js`), stores them, and writes them to an
   **app-owned metafield** (`pingzest.config`) with `metafieldsSet`.
3. The theme app embed (`blocks/app-embed.liquid`, one switch in the theme editor) prints that JSON with
   `{{ app.metafields.pingzest.config.value | json }}` plus the page type, so the storefront script needs
   no network request to load settings.
4. `assets/wa-widget.js` builds the chat button and banner, applies page rules, styles the page buttons,
   and sends **one** analytics request per page for views (plus one per click) to the app proxy.

## How the COD flow works

1. A COD order arrives (`orders/create` webhook). The app saves it with a random, expiring confirm token.
2. In **COD confirmation**, the merchant clicks **Send on WhatsApp**. WhatsApp opens with:
   > Hi Priya, thank you for shopping with Kurta House! … Please tap to confirm or cancel your order:
   > https://your-app.com/c/Ab3dE5fG7hJ9
3. The link shows a preview card that looks like buttons (`public/og-confirm.png`).
4. The customer taps it and chooses **Confirm** or **Cancel**. The order gets the `wa-cod-confirmed` or
   `wa-cod-cancelled` tag in Shopify, and the queue updates.
5. The merchant filters cancelled orders in Shopify and cancels them before shipping. The app never cancels orders itself.

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

## Plans

`app/lib/plans.js`. **Free:** 5 custom message templates; the built-in Standard template for every stage and language
is always included and doesn't count. **Pro:** unlimited. Billing isn't built yet; to upgrade a store by hand set
`plan: "pro"` on its `ShopSettings` document in MongoDB.

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
npm test                 # 87 unit tests: phone cleanup, templates (picking, validation), WhatsApp
                         # formatting, links, order parsing, tokens, widget settings, page rules,
                         # discount form, message analytics, store-address login input, languages
                         # (every string translated, placeholders and plurals intact, Intl formatting),
                         # PostHog logging (redaction, batching, flags, request middleware), plan limits
npm run test:widgets     # 19 browser checks of the storefront: designs, mobile, page rules, banner,
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

- `customers/data_request` currently logs the data; send it to the merchant by email before launch.
- The "Turn on" checklist steps can't detect whether the embed or blocks are enabled (needs the theme API).
- Discount "orders" count any order that used one of the app's codes (from any channel), not only shoppers who clicked the banner.
- Upgrading from the first version: the old `chat-button` block is replaced by the `app-embed` embed; re-enable it once in the theme editor.
- Delivered status relies on `fulfillments/update` with `shipment_status = delivered`, which only some couriers send. Merchants can also mark delivered by hand.
- The admin uses a small custom UI kit; swap to Polaris web components if you go for the Built for Shopify badge.
- Wix version: the logic in `app/lib/` is platform-neutral and can be reused.

## License

No license file is included yet, so by default all rights are reserved. Add one (e.g. MIT) if you want others to reuse the code.
