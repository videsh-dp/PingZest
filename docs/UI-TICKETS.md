# PingZest UI tickets (Nov 2026)

These tickets merge two research reports:
- **S** = `03-ui-shopify-standards.md`: Shopify design rules, the Built for Shopify (BFS) requirements and an audit of 24 items.
- **C** = `04-ui-competitors.md`: competitor UI patterns, merchant complaints and page-by-page recommendations.

They were checked against the code on `research-features` (5821691). Two claims were also checked directly at the source:
- **BFS 4.1.4.** An app should use Shopify's admin navigation menu, not one of its own. Emoji in the menu are also a rejection reason.
- **Page load.** The app's layout loader runs the COD autopilot before every page renders.

Effort: **S** ≤ 2 days · **M** = 1–2 weeks · **L** = 2–3 weeks or more.

---

## Phase 0: clear the review blockers and quick wins (about 1 week)

| ID | Change | Why | Effort |
|---|---|---|---|
| UI-01 | **Remove the in-app left sidebar.** Move the "to send" counts to a "Today" card on Home and to the tab counts on each queue page. **Needs the owner's decision.** The sidebar was added at the owner's request for a self-hosted setup. S#1 notes every `/app` route redirects into the admin, so a "show only outside Shopify" option would never run. | Blocker: BFS 4.1.4 (S#1–2). C#4 | S |
| UI-02 | **Cut Shopify's app menu to 7 items, with no emoji.** Shopify hides anything past 7 behind "View more". Fold Discounts into Widgets and Plan into Settings, or merge the three order queues. | S#3 | S |
| UI-03 | **Neutral primary buttons.** Shopify names green as a rejection example, and white on the current green fails the 4.5:1 contrast minimum. Keep WhatsApp green only for WhatsApp-specific actions and previews. | Blocker: BFS 4.1.1 (S#5) | S |
| UI-04 | **Use Shopify's save bar** on Settings, Widgets, Templates and Discounts, and warn before leaving with unsaved changes. | Blocker: BFS 4.1.5 (S#6) | M |
| UI-05 | **COD-first setup guide on Home.** Put it at the top, keep it to 5 steps or fewer, let merchants dismiss it, and have steps tick themselves. Steps: WhatsApp number · confirm your first COD order (or send a test to yourself) · hold fulfillment · return cost · theme embed. Read the theme status for real. Today **3 steps are hard-coded "not done", so the guide can never finish** (verified in code). | Blocker: BFS 4.2.2/4.2.3 (S#7–8). C top 1 | S |
| UI-06 | **Move autopilot and plan sync out of the page load.** Run them after the response, on webhooks and on cron, so every page opens fast. Shopify's speed targets: LCP ≤ 2.5s, INP ≤ 200ms. | High: BFS 2.1 (S#11) | S |
| UI-07 | **Trust pass on the customer side:** a short confirm link in the message, the store's logo and name on the confirm page, the address shown on Free too, plus "pay the courier in cash" and "we never ask for an OTP". Replace `window.confirm` with a styled sheet. | C top 3, S#24 | S |
| UI-08 | **Public landing page:** remove the template's "type your myshopify domain" login. | App Store 2.3.1 (S#17) | S |

## Phase 1: daily-work speed (about 1–2 weeks)

| ID | Change | Why | Effort |
|---|---|---|---|
| UI-09 | **COD queue "Send & next" mode.** Richer rows (items, PIN code, order age, risk), sort by risk or age, and keyboard shortcuts. One filled primary button per page, with row actions as secondary buttons. | C top 2, S#15 | M |
| UI-10 | **Home as a status page:** the setup guide (until done), then a "Today" to-do list, a ₹-saved headline and system status. Show one banner at a time. | C top 5, S#9 | S |
| UI-11 | **Analytics opens on Returns** (₹ saved, confirmed vs unconfirmed RTO), not the empty Messages tab. | C top 6 | S |
| UI-12 | **Order timeline:** a per-order activity log (sent, reminded, confirmed, held, cancelled) with Retry and a link to the order in Shopify. | C top 9 | M |
| UI-13 | **Styled modals for destructive actions** (delete, cancel order, cancel Pro) instead of native `window.confirm`. | High: BFS 4.1.6 (S#10) | S |
| UI-14 | **COD queue on mobile:** tabs that don't wrap (6 tabs today; at most 4 with "More"), and cards with the action within thumb reach. | C top 7, S#14 | S |
| UI-15 | **Editors with a back path:** the template editor and Create discount open as their own page or a modal with a breadcrumb. | S#13 | S |
| UI-16 | **Settings grouped by job.** Show the COD rules on the COD page, and remove "Sign out" from the embedded app. | C top 8, S#18 | S |

## Phase 2: move to Polaris web components (about 2–3 weeks)

| ID | Change | Why | Effort |
|---|---|---|---|
| UI-17 | Rebuild the `ui.jsx` wrappers on Polaris web components in this order: `s-page`/`s-section` → `s-banner`/`s-badge`/`s-empty-state` → `s-table` with pagination and bulk select → forms. Use Polaris icons instead of emoji. Check whether AppProvider already loads Polaris (probably loaded but unused today). Controlled form fields need **React 19** (the app is on 18.3). Keep custom CSS only for WhatsApp bubbles, previews and charts. | S direction, S#12, #16, #19–21 | L |

## Later

- UI-18: a permanent "WhatsApp the founder" help link, plus a review ask after the first ₹ milestone. Founder-led onboarding is what merchants praise most in top-rated apps (C top 10). Needs the App Store listing link.
- UI-19: language preview in English and Hindi side by side in the template editor (C).

**Built for Shopify badge:** it also needs 50 net installs on paid plans and 5 reviews (BFS 1.2), so treat it as a goal for after launch. Phase 0 is still worth doing before App Store review.

---

## Status (branch `ui-overhaul`, Nov 2026)

UI-01 to UI-17 are **Done**. UI-18 and UI-19 are still "Later".

| ID | Status | Commits | Notes |
|---|---|---|---|
| UI-01 | Done | efe83ef | Sidebar, its CSS and the mobile "Menu" button removed. The counts now sit in Home's **Today** list and in the queue tab counts. |
| UI-02 | Done | efe83ef | NavMenu has 7 items and no emoji: COD confirmation · Abandoned checkouts · Order updates · Templates · Widgets · Analytics · Settings. The three queues stay separate and first, so the daily COD loop is one click away. Discounts moved to `/app/widgets/discounts` and Plan to `/app/settings/plan`; the old URLs redirect. |
| UI-03 | Done | efe83ef | The primary colour is the admin's near-black. WhatsApp green is used only for the WhatsApp icon, bubbles and previews. "Send on WhatsApp" is a secondary button with the WhatsApp mark. |
| UI-04 | Done | efe83ef, a23065e | `<ui-save-bar>` (via `shopify.saveBar`) on Settings, Widgets, the template editor and Create discount. In-app links are blocked with a "Leave page?" modal, and `beforeunload` covers closing the tab. |
| UI-05 | Done | efe83ef, cbdf100 | Setup guide with 5 steps: number · first COD send (or a self-test via `/c/sample`) · hold · return cost · theme embed. It shows "X of 5", can be collapsed (remembered in the browser) and dismissed (saved per shop), and hides itself when complete. Theme status is read with App Bridge `shopify.app.extensions()`, browser-only because no server API exists. The result is stored, and merchants tick the step themselves where App Bridge can't report it. |
| UI-06 | Done | efe83ef, a7144c2 | The layout loader reads stored settings only. `syncPlan` and `processDueCod` run after the response (plus webhooks and `/cron/cod`). Plan gates stay correct through the subscription webhook and the Plan page's forced check. `shouldRevalidate` stops the layout re-running on every click. Web Vitals go to PostHog as numbers only. |
| UI-07 | Done | efe83ef | Tokens are now 128-bit (22 characters) on the same short `/c/<token>` path, with no external shortener; older 12-character links keep working until they expire. The confirm page shows the store logo (optional https URL in Settings) or its initial, the address on Free (read-only), and "pay the courier in cash" / "never ask for an OTP" lines. A styled two-step cancel sheet replaces `window.confirm`. |
| UI-08 | Done | efe83ef | The public page links to the App Store. The store-address form remains only behind `SHOW_LOGIN_FORM=1`, in development, and on `/auth/login`. |
| UI-09 | Done | a23065e | Send & next stays in the page, not the admin title bar, so it can open WhatsApp from the merchant's own tap. Rows show items, PIN code, order age and risk. Sort by age, value or risk (Pro). Shortcuts: S, J/K, C. Each row has one secondary send button plus a "•••" menu. |
| UI-10 | Done | efe83ef | Home shows the guide, one Needs attention banner, Today, the ₹-saved headline and a Status card (hold, timers, widgets live, plan). |
| UI-11 | Done | a23065e | Analytics opens on Returns. |
| UI-12 | Done | a23065e | `/app/cod/:id` timeline, built from stored order facts and the message log. It has Retry/Dismiss for failed actions and Open in Shopify. |
| UI-13 | Done | efe83ef, 00d4666 | Shared `ConfirmModal` on native `<dialog>`, portalled to `<body>`, for delete, cancel order, mark cancelled, RTO and cancel Pro. |
| UI-14 | Done | a23065e, 929ffc0 | 3 tabs plus a "More" menu that never wraps. Send & next sits at the bottom of the screen on phones. s-table switches to a list layout on narrow screens. |
| UI-15 | Done | a23065e | `/app/templates/:id` and `/app/widgets/discounts/new` each have a breadcrumb. |
| UI-16 | Done | efe83ef | Settings tabs: Store & WhatsApp · COD rules (Free and Pro together, Pro disabled in place) · Checkouts · Plan. A COD rules card is on the COD page. Sign out removed. |
| UI-17 | Done | 9a11837, 00d4666, a82ba6f, 945b0cd | Done in this order: `s-page`/`s-section` → `s-banner`/`s-badge`/`s-icon` → `s-table` with pagination (50 per page) and bulk select (COD Mark confirmed / Returned) → Settings form fields. The app stays on **React 18**: fields are uncontrolled, values are read from the fields on save, and checked state is set as a property. AppProvider already loaded Polaris; it is now used. In the embedded admin, App Bridge shows the page heading, breadcrumb and header buttons in the admin title bar; the browser tests' App Bridge stand-in draws an equivalent bar. |

Left as custom UI on purpose: the WhatsApp bubble and phone preview, the widget editor and preview, charts, the setup guide, the template editor's toolbar, and the Create discount form (a mixed amount + unit control).
