# Shopify App Store submission checklist (free plan)

Work through this before you press "Submit for review".

## Partner Dashboard
- [ ] App created; `npm run config:link` done; `npm run deploy` run so webhooks and the theme extension are live
- [ ] **Protected customer data → Level 2**: request access to **Phone** and **Name**. Reason: "Merchants send
      order confirmations and shipping updates to their customers on WhatsApp. We need the customer's
      phone and first name to prepare those messages. We do not need address or email."
- [ ] Complete the data protection questionnaire (retention, encryption, staff access, incident response)
- [ ] Privacy policy URL (use `docs/PRIVACY_POLICY_TEMPLATE.md`, host it on your site)
- [ ] Support email and a help or FAQ page

## App behaviour reviewers test
- [ ] Installs cleanly and lands on the dashboard (no blank screen, no login prompt)
- [ ] OAuth runs immediately after install, and reinstalling after uninstall works
- [ ] All three compliance webhooks return 200 (`/webhooks/compliance`)
- [ ] `app/uninstalled` removes sessions
- [ ] Theme app extension works on Dawn (the default theme): app embed + product + cart blocks
- [ ] Widgets don't break store speed (scripts load with `defer`, CSS is small, no external requests)
- [ ] Every link and button in the admin works; empty states make sense on a brand-new store
- [ ] No mention of features that aren't built (e.g. "automated sending")

## Listing
- [ ] Name (check it doesn't use "WhatsApp" in a way that implies endorsement by Meta; "for WhatsApp" phrasing is safer)
- [ ] App icon (1200×1200, original artwork, no WhatsApp logo)
- [ ] 3–6 screenshots at 1600×900 (dashboard, COD queue, confirm page, storefront widget, templates)
- [ ] Short intro: "Confirm COD orders on WhatsApp and cut returns. Free chat button, order-on-WhatsApp and order updates."
- [ ] Pricing: Free
- [ ] Demo store URL with the widgets switched on, and a screencast of the COD flow for reviewers
- [ ] Test instructions for reviewers: how to place a COD order and see it in the queue

## Before real merchants
- [ ] MongoDB Atlas in production (replica set, backups on, IP access list set)
- [ ] Pricing in the listing matches `app/lib/plans.js` (Free + Pro $9.99/mo or $99/yr, 7-day trial)
- [ ] `BILLING_TEST=false` in production; test upgrade, cancel and a failed payment on a dev store first
- [ ] Reviewers can try Pro: mention in the review notes that test charges are approved free on dev stores
- [ ] PostHog: `POSTHOG_API_KEY` set, alerts on `$exception` and `privacy_data_request`
- [ ] Protected customer data form: list PostHog and MongoDB Atlas as processors (no customer data goes to PostHog)
- [ ] Email the merchant on `customers/data_request` (currently only logged)
- [ ] Error monitoring (e.g. Sentry) and uptime check on `/c/` pages
- [ ] Back up the database daily
- [ ] Check your SuperLemon employment contract for non-compete or IP clauses
