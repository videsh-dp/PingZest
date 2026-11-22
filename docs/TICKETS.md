# PingZest tickets (from the Nov 2026 research)

Derived from two research reports (kept outside the repo):
- **R1** `01-customer-needs.md`: merchant jobs, churn reasons, price signals.
- **R2** `02-competitors.md`: competitor table and **§5 Gap analysis** with ranked moves (R2 §5.2 "Move N").

Each ticket was checked against the code on `overnight-e2e` (Nov 22, 2026) before being written.

**Already in the app (checked, so no ticket is needed):**
- Auto-tags on COD confirm and cancel (Settings → Orders). Pro adds the high-risk and prepaid tags.
- The confirm page and the default templates already exist in all 7 languages, Hindi included: `app/i18n/confirm.js` and `DEFAULT_TEMPLATES` in `app/lib/templates.js`.
- Phone numbers are normalised with the default country code (`app/lib/phone.js`).
- Risk score, COD → prepaid and address check are on Pro.

**Progress (Nov 22, 2026):**
- **Done on branch `research-features`:** PZ-01 to PZ-08.
- **New scope to approve:** `write_merchant_managed_fulfillment_orders`.
- **Optional env var:** `CRON_SECRET`, for `POST /cron/cod`.

Effort: **S** = up to 2 days, **M** = 1–3 weeks, **L** = 1–2 months (one developer).
Status: **To do** · **In progress** · **Done** (with commit) · **Later** (blocked by a dependency) · **Needs decision** (reserved for the owner).

---

## Now: buildable without Meta, checkout or payment changes

### PZ-01 · Hold fulfillment of COD orders until they're confirmed
- **Problem:** confirmation stops at a tag, so staff can still pack and ship an unconfirmed COD order. OrderPing and Level hold fulfillment at $0–$4.99 (R2 §5.1 row 1; R2 Move 1; R1 §4 "Missing" item 3).
- **Acceptance criteria:**
  - Settings → Orders has "Hold fulfillment of new COD orders until the customer confirms". It's off by default.
  - When it's on, an incoming COD order's open fulfillment orders get `fulfillmentOrderHold` (reason OTHER, with a note). The hold ids are stored on the order.
  - The hold is released (`fulfillmentOrderReleaseHold`) when the order is confirmed by the customer, by the merchant or by paying online. The queue offers a "Release hold" button.
  - Failures are recorded on the order and shown as an alert (PZ-07). They never block the webhook.
  - Covered by the e2e test, and the fake Shopify validates against the real schema.
- **Plan:** Free. **Effort:** S.
- **Dependencies:** new scope `write_merchant_managed_fulfillment_orders`. Stores that only fulfil from third-party fulfillment-service locations aren't covered: that would need `write_third_party_fulfillment_orders` too, so it's left out until asked for.
- **Status:** Done (f1a237a).

### PZ-02 · Reminder and expiry for unconfirmed COD orders
- **Problem:** customers who don't reply are left in "Waiting" forever. Competitors nudge at 24h and expire at 72h (R1 §5 #5; R2 Move 1).
- **Acceptance criteria:**
  - Settings → Orders has "Remind after (hours)" (default 24) and "Expire after (hours)" (default 72), plus a "no reply" tag (default `wa-cod-no-reply`).
  - The COD queue gets a **To remind** tab: orders sent more than X hours ago with no answer and no reminder yet. "Send reminder" opens WhatsApp with a reminder message. It's sent by hand, as always.
  - **Free:** an "Expire now" button on waiting orders sets *No reply* and adds the tag.
  - **Pro:** "Expire automatically" sets *No reply* plus the tag once the expiry time has passed.
  - Automation needs no separate worker. It runs on each COD webhook and on app load (throttled to once every 10 minutes per shop). There's also `POST /cron/cod` for an external scheduler, protected by `CRON_SECRET`.
  - The due/expiry rules are pure functions with unit tests.
- **Plan:** Free (tab, manual buttons, settings) / Pro (automatic expiry). **Effort:** S–M.
- **Dependencies:** none. Reminders are manual until automated sending exists (PZ-20).
- **Status:** Done (f1a237a).

### PZ-03 · Cancel and restock in Shopify
- **Problem:** cancelled and expired COD orders must be cancelled by hand in Shopify. The app's footnote says "PingZest doesn't cancel orders for you" (R2 Move 1; R1 §4 item 3).
- **Acceptance criteria:**
  - **Free:** a "Cancel in Shopify" button on Cancelled and No reply orders, behind a confirm dialog. It calls `orderCancel` with restock (setting, default on), reason CUSTOMER or OTHER, no customer notification and a staff note. It's shown once per order (state stored).
  - **Pro (opt-in, both off by default):** "Cancel and restock automatically when the customer cancels" and "…when an order expires".
  - Shipped, paid-online and already-cancelled orders are never cancelled.
  - Errors are recorded and shown as an alert.
- **Plan:** Free (manual) / Pro (automatic). **Effort:** S.
- **Dependencies:** `write_orders` (already granted).
- **Status:** Done (f1a237a).

### PZ-04 · "₹ RTO saved" headline
- **Problem:** merchants pay when they can tie the app to rupees saved. Only OrderPing shows a savings number (R1 §3 "Signals"; R2 Move 2; R2 §5.1 row 14).
- **Acceptance criteria:**
  - Settings → Orders has "Average cost of one returned COD parcel". It defaults to 500 for INR stores and 0 (= not set) otherwise, in the store currency.
  - Home and Analytics show "Saved on returns": (COD orders cancelled or expired before shipping + COD orders switched to prepaid) × average cost, for the period. The formula is explained in the UI.
  - Shown on Free.
  - Pure calculation with unit tests.
- **Plan:** Free. **Effort:** S.
- **Dependencies:** none.
- **Status:** Done (542c323).

### PZ-05 · RTO breakdowns (Pro)
- **Problem:** a single RTO % hides the patterns. Merchants want cuts by pincode, first-time buyer, coupon and order hour, and confirmed vs unconfirmed RTO (R1 §1 job 2; R2 Move 2).
- **Acceptance criteria:**
  - New order facts saved from the webhook:
    - first-time buyer (customer `orders_count` ≤ 1, else the store's own history by phone)
    - hour the order was placed (store's local time from `created_at`)
    - coupon used (already stored)
    - pincode (already stored)
  - A "Mark returned (RTO)" action on shipped COD orders (Confirmed and No reply tabs), plus Undo.
  - Analytics → **Returns** tab:
    - the headline (Free)
    - Pro only: tables by pincode (top 10, min. 3 orders), first-time vs repeat, coupon vs none and hour band, each with COD orders, cancel %, no-reply % and RTO %
    - Pro only: RTO split by confirmed vs unconfirmed orders
    - Pro only: CSV export
  - Free sees a locked card with an upgrade link. No breakdown data is sent to the page on Free.
- **Plan:** Free headline / Pro breakdowns. **Effort:** M.
- **Dependencies:** PZ-04. True delivery outcome comes from the manual mark. Courier integration is PZ-25.
- **Status:** Done (542c323).

### PZ-06 · Value framing on the Plan page
- **Problem:** "Pays for itself after 2 saved RTOs" is the pitch. The feature list doesn't say it (R2 §5.4; R1 §3).
- **Acceptance criteria:**
  - The Plan page shows the store's own "saved on returns" (PZ-04) and how many prevented returns cover Pro.
  - It states "Zero markup: you never pay per message to PingZest".
  - The feature list includes the new loop features.
  - Prices and plan structure are unchanged.
- **Plan:** Free. **Effort:** S.
- **Dependencies:** PZ-04.
- **Status:** Done (542c323).

### PZ-07 · Alerts for stuck work
- **Problem:** silent failures are churn cause #2: "automations stop and nobody notices" (R1 §2 item 2; R2 Move 7; R2 §3 weak spot 1).
- **Acceptance criteria:**
  - Home shows a banner listing what's stuck, each item linking to the right tab:
    - COD orders waiting for a reply longer than the reminder time
    - COD orders not sent for 12h+
    - orders with no valid WhatsApp number
    - Shopify actions that failed (tag, hold, release, cancel), with the error
    - shipments in transit for 7+ days with no delivery (stalled)
  - The sidebar shows an alert badge on Home. (Since UI-01 the sidebar is gone: Home's Today list and Needs attention banner carry this.)
  - Failed actions can be retried or dismissed.
  - No external messages (no email or WhatsApp to the merchant).
  - The counting rules are a pure function with unit tests.
- **Plan:** Free. **Effort:** S.
- **Dependencies:** PZ-01 and PZ-03 for the action errors.
- **Status:** Done (e92feea).

### PZ-08 · Phone-number health on the COD queue
- **Problem:** in R1 §1 job 8, half the broadcasts failed because of missing country codes.
- **Acceptance criteria:**
  - Orders whose phone couldn't be normalised show "No valid number" with a hint to check the default country code.
  - Counted in PZ-07.
- **Plan:** Free. **Effort:** S.
- **Dependencies:** PZ-07.
- **Status:** Done (e92feea).

### PZ-09 · In-app review ask after the first savings milestone
- **Problem:** reviews drive ranking against the new COD apps, which have 0 reviews (R2 Move 6).
- **Acceptance criteria:** after 5 COD orders saved (PZ-04), Home shows a dismissible card asking for a review. One click opens the App Store listing.
- **Plan:** Free. **Effort:** S.
- **Dependencies:** the App Store listing URL (the app isn't listed yet).
- **Status:** Later.

### PZ-10 · Regional languages for the confirm page and templates
- **Problem:** in India, what matters is the customer-facing language (R1 §4 "over-built"; R2 Move 9).
- **Acceptance criteria:** add Tamil, Telugu, Bengali and Marathi to the confirm-page texts and default templates, reviewed by native speakers.
- **Plan:** Free. **Effort:** S per language.
- **Dependencies:** native-speaker review. Hindi and English are already done.
- **Status:** Later.

---

## Later / needs decision

### PZ-20 · Automated sending through the merchant's own Meta number (Cloud API, coexistence)
- **Problem:** the scaling unlock. Manual sending breaks above about 20–50 COD orders a day (R2 Move 4; R1 §4 item 1).
- **Scope:** utility templates for COD confirm, reminders and expiry, then shipped/delivered, then cart recovery. The merchant pays Meta directly, with zero markup.
- **Plan:** Pro. **Effort:** L.
- **Dependencies:** Meta Tech Provider onboarding and App Review, embedded signup, template approval API, delivery webhooks.
- **Status:** Needs decision (reserved: needs Meta approval).

### PZ-21 · Guided Meta setup wizard
- **Scope:** checklist, embedded signup, utility template kit in Hindi and English, coexistence explainer (R2 Move 10).
- **Plan:** Free. **Effort:** M.
- **Dependencies:** ships with PZ-20.
- **Status:** Needs decision.

### PZ-22 · Cost guardrails
- **Scope:** estimated Meta cost per flow, a monthly cap, failure reasons (131049, template pending) and auto-retry (R2 Moves 3 and 7).
- **Plan:** Free. **Effort:** S–M.
- **Dependencies:** PZ-20. Until then, the "zero markup" copy is in PZ-06.
- **Status:** Later.

### PZ-23 · Risk-based COD controls at checkout (hide COD / COD fee)
- **Scope:** hide COD or add a fee by risk score, pincode, cart value or tag (R2 Move 5).
- **Plan:** Pro. **Effort:** M.
- **Dependencies:** a Shopify Function (payment customization), scope `write_payment_customizations`, and checking eligibility on non-Plus stores.
- **Status:** Needs decision (reserved: checkout customization).

### PZ-24 · Partial COD / advance fee on the confirm page
- **Scope:** "pay ₹49–99 now to confirm" (R2 Move 8; R1 §1 job 12).
- **Plan:** Pro. **Effort:** M.
- **Dependencies:** a payment link or gateway webhooks, plus order edits to record payment. Payment-handling compliance.
- **Status:** Needs decision (reserved: payments).

### PZ-25 · Out-for-delivery message + address-fix link (NDR prevention)
- **Problem:** R1 §1 job 5; R2 Move 11.
- **Plan:** Pro. **Effort:** M–L.
- **Dependencies:**
  - carrier events (`out_for_delivery` / `failure`) reaching Shopify fulfillments, which Indian couriers rarely send
  - likely a Shiprocket/Delhivery integration
  - automatic sending needs PZ-20
- **Status:** Later.

### PZ-26 · Self-serve order status page linked from the chat widget
- **Problem:** WISMO (R1 §1 job 4). The stalled-shipment flag is already part of PZ-07.
- **Plan:** Free. **Effort:** M.
- **Dependencies:** product decision. Shopify's own order status page may be enough.
- **Status:** Later.

### PZ-27 · Unlimited templates on Free
- **Problem:** R2 §5.3 suggests removing the 5-template limit.
- **Plan:** Free. **Effort:** S.
- **Dependencies:** owner decision. The limit stays at 5 for now.
- **Status:** Needs decision (reserved).

### PZ-28 · "Growth" tier around $19.99–$24.99 after automation ships
- **Problem:** R2 §5.4.
- **Plan:** – . **Effort:** S.
- **Dependencies:** PZ-20 and a pricing decision.
- **Status:** Needs decision (reserved: prices and plan structure).

### Won't build (R2 §5.3)
- Broadcast/campaign builder
- Shared inbox
- AI agents
- Catalog checkout in WhatsApp
- Shared-number sending
