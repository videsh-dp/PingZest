import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { syncPlan, requestPlan, cancelPlan, isTestBilling } from "../models/billing.server";
import { customTemplateAllowance } from "../models/templates.server";
import { riskTeaser } from "../models/risk.server";
import { Page, Card, Banner } from "../components/ui";
import { useT } from "../i18n/react.jsx";
import { BILLING_PLANS, FEATURE_LIST, PRO_MONTHLY, PRO_YEARLY, TRIAL_DAYS, planOf } from "../lib/plans.js";

export const loader = async ({ request }) => {
  const { session, billing, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const upgraded = new URL(request.url).searchParams.get("upgraded") === "1";
  const settings = await syncPlan(shop, billing, admin, { force: upgraded });
  const [allowance, risky] = await Promise.all([customTemplateAllowance(shop), riskTeaser(shop)]);
  return {
    plan: planOf(settings),
    subscriptionName: settings.subscriptionName,
    trialEndsAt: settings.trialEndsAt,
    upgraded,
    isTest: isTestBilling(),
    prices: BILLING_PLANS,
    allowance,
    risky,
  };
};

export const action = async ({ request }) => {
  const { session, billing, admin } = await authenticate.admin(request);
  const form = Object.fromEntries(await request.formData());
  if (form.intent === "upgrade") {
    const name = form.interval === "yearly" ? PRO_YEARLY : PRO_MONTHLY;
    return requestPlan(billing, session.shop, name); // redirects to Shopify's approval page
  }
  if (form.intent === "cancel") return cancelPlan(billing, session.shop, admin);
  return { error: "Unknown action" };
};

export default function PlanPage() {
  const tr = useT();
  const d = useLoaderData();
  const fetcher = useFetcher();
  const [interval, setInterval] = useState(d.subscriptionName === PRO_YEARLY ? "yearly" : "monthly");
  const busy = fetcher.state !== "idle";
  const isPro = d.plan === "pro";
  const monthly = d.prices[PRO_MONTHLY];
  const yearly = d.prices[PRO_YEARLY];
  const price = interval === "yearly" ? yearly : monthly;
  const saving = Math.round((1 - yearly.amount / (monthly.amount * 12)) * 100);

  return (
    <Page title={tr("Plan")} subtitle={tr("Pro adds the COD money-savers and removes the limits. Billed by Shopify on your Shopify invoice.")}>
      {d.upgraded && isPro && <Banner tone="success">{tr("You're on Pro. Thank you!")}</Banner>}
      {d.isTest && <Banner tone="info">{tr("Test mode: approving a plan here doesn't charge anything.")}</Banner>}
      {fetcher.data?.error && <Banner tone="critical">{tr(fetcher.data.error)}</Banner>}

      {!isPro && d.risky.high > 0 && (
        <Banner tone="warning">
          {tr.plural("{count} COD order in the last 30 days looked risky.", "{count} COD orders in the last 30 days looked risky.", d.risky.high)}{" "}
          {tr("Pro shows which ones and why, so you can call or ask for prepaid before shipping.")}
        </Banner>
      )}

      <div className="wa-plans">
        <Card title={tr("Free")} className={!isPro ? "wa-plan is-current" : "wa-plan"}>
          <p className="wa-plan__price">{tr("Free forever")}</p>
          <ul className="wa-plan__list">
            {FEATURE_LIST.map((f) => (
              <li key={f.key} className={f.free ? "" : "is-off"}>
                <span aria-hidden="true">{f.free ? "✓" : "–"}</span> {tr(f.label)}
                {typeof f.free === "string" && <strong> · {tr(f.free)}</strong>}
              </li>
            ))}
          </ul>
          {!isPro && <p className="wa-muted wa-small">{tr("Custom templates: {used} of {limit}", { used: d.allowance.used, limit: d.allowance.limit })}</p>}
          {!isPro && <span className="wa-badge">{tr("Current plan")}</span>}
        </Card>

        <Card title={tr("Pro")} className={isPro ? "wa-plan wa-plan--pro is-current" : "wa-plan wa-plan--pro"}>
          <div className="wa-seg" role="group" aria-label={tr("Billing period")}>
            <button type="button" className={interval === "monthly" ? "is-active" : ""} onClick={() => setInterval("monthly")}>{tr("Monthly")}</button>
            <button type="button" className={interval === "yearly" ? "is-active" : ""} onClick={() => setInterval("yearly")}>
              {tr("Yearly")} {saving > 0 && <span className="wa-badge wa-badge--success">{tr("Save {percent}%", { percent: saving })}</span>}
            </button>
          </div>
          <p className="wa-plan__price">
            {tr.money(price.amount, price.currency)}
            <span className="wa-muted"> / {interval === "yearly" ? tr("year") : tr("month")}</span>
          </p>
          <ul className="wa-plan__list">
            {FEATURE_LIST.map((f) => (
              <li key={f.key}>
                <span aria-hidden="true">✓</span> {tr(f.label)}
                {typeof f.pro === "string" && <strong> · {tr(f.pro)}</strong>}
              </li>
            ))}
          </ul>
          {isPro ? (
            <>
              <span className="wa-badge wa-badge--success">{tr("Current plan")}</span>
              {d.trialEndsAt && <p className="wa-muted wa-small">{tr("Free trial until {date}", { date: tr.date(d.trialEndsAt) })}</p>}
              <button
                type="button"
                className="wa-link wa-link--danger"
                disabled={busy}
                onClick={() => window.confirm(tr("Cancel Pro? Your store moves to the Free plan now, and Shopify credits the unused time.")) && fetcher.submit({ intent: "cancel" }, { method: "post" })}
              >
                {tr("Cancel Pro")}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="wa-button wa-button--primary wa-button--full" disabled={busy} onClick={() => fetcher.submit({ intent: "upgrade", interval }, { method: "post" })}>
                {busy ? tr("Opening Shopify…") : tr("Start {days}-day free trial", { days: TRIAL_DAYS })}
              </button>
              <p className="wa-muted wa-small">{tr("You approve the charge in Shopify. Cancel any time during the trial and you won't be charged.")}</p>
            </>
          )}
        </Card>
      </div>
    </Page>
  );
}
