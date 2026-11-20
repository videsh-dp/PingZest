import { useEffect, useRef } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { listDiscounts, createDiscount, toggleDiscount, removeDiscount } from "../models/discounts.server";
import { getWidgetConfig } from "../models/widgets.server";
import { Page, Card, Banner, EmptyState, ActionButton } from "../components/ui";
import prisma from "../db.server";
import { useT } from "../i18n/react.jsx";
import { toId } from "../lib/ids.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [discounts, { config }] = await Promise.all([listDiscounts(shop), getWidgetConfig(shop)]);
  // orders that used each code (all time)
  const orders = await prisma.order.findMany({ where: { shop, NOT: { discountCodes: "" } }, select: { discountCodes: true } });
  const uses = {};
  for (const o of orders) for (const c of o.discountCodes.split(",")) uses[c] = (uses[c] || 0) + 1;
  return {
    bannerCode: config.discount.enabled ? config.discount.code : "",
    discounts: discounts.map((d) => ({
      id: d.id, code: d.code, title: d.title, active: d.active, kind: d.kind, value: d.value,
      minSubtotal: d.minSubtotal, endsAt: d.endsAt, oncePerCustomer: d.oncePerCustomer, uses: uses[d.code] || 0,
    })),
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const form = Object.fromEntries(await request.formData());
  if (form.intent === "create") return createDiscount(session.shop, admin, form);
  const id = toId(form.id);
  if (!id) return { error: "Not found" };

  if (form.intent === "activate") return toggleDiscount(session.shop, admin, id, true);
  if (form.intent === "deactivate") return toggleDiscount(session.shop, admin, id, false);
  if (form.intent === "delete") return removeDiscount(session.shop, admin, id);
  return { error: "Unknown action" };
};

function CreateForm() {
  const tr = useT();
  const fetcher = useFetcher();
  const formRef = useRef(null);
  const errors = fetcher.data?.errors || {};
  const created = fetcher.state === "idle" ? fetcher.data?.discount : null;
  useEffect(() => { if (created) formRef.current?.reset(); }, [created]);

  return (
    <Card title={tr("Create a discount code")}>
      {created && (
        <Banner tone="success">
          <strong>{created.code}</strong> {tr("is live in your Shopify discounts.")} <Link to="/app/widgets">{tr("Show it in the discount banner →")}</Link>
        </Banner>
      )}
      {errors.form && <Banner tone="critical">{tr(errors.form)}</Banner>}
      <fetcher.Form method="post" ref={formRef} className="wa-form-grid">
        <input type="hidden" name="intent" value="create" />
        <label className="wa-field">
          <span className="wa-field__label">{tr("Code")}</span>
          <input className={`wa-input ${errors.code ? "has-error" : ""}`} name="code" placeholder="WELCOME10" required maxLength={30} style={{ textTransform: "uppercase" }} />
          {errors.code && <span className="wa-error">{tr(errors.code)}</span>}
        </label>
        <div className="wa-field">
          <span className="wa-field__label">{tr("Discount")}</span>
          <div className="wa-inline">
            <input className={`wa-input wa-input--num ${errors.value ? "has-error" : ""}`} name="value" type="number" min="1" step="any" placeholder="10" required />
            <select name="kind" className="wa-input wa-input--inline" defaultValue="percentage">
              <option value="percentage">{tr("% off")}</option>
              <option value="fixed">{tr("amount off (₹)")}</option>
            </select>
          </div>
          {errors.value && <span className="wa-error">{tr(errors.value)}</span>}
        </div>
        <label className="wa-field">
          <span className="wa-field__label">{tr("Minimum order (optional)")}</span>
          <input className={`wa-input ${errors.minSubtotal ? "has-error" : ""}`} name="minSubtotal" type="number" min="0" step="any" placeholder={tr("e.g. 999")} />
          {errors.minSubtotal && <span className="wa-error">{tr(errors.minSubtotal)}</span>}
        </label>
        <label className="wa-field">
          <span className="wa-field__label">{tr("Ends on (optional)")}</span>
          <input className={`wa-input ${errors.endsAt ? "has-error" : ""}`} name="endsAt" type="date" />
          {errors.endsAt && <span className="wa-error">{tr(errors.endsAt)}</span>}
        </label>
        <label className="wa-field wa-span2">
          <span className="wa-field__label">{tr("Internal name (optional)")}</span>
          <input className="wa-input" name="title" placeholder={tr("Shown in Shopify admin → Discounts")} maxLength={80} />
        </label>
        <label className="wa-check wa-span2">
          <input type="checkbox" name="oncePerCustomer" defaultChecked /> {tr("Each customer can use it once")}
        </label>
        <div className="wa-span2">
          <button type="submit" className="wa-button wa-button--primary" disabled={fetcher.state !== "idle"}>
            {fetcher.state !== "idle" ? tr("Creating in Shopify…") : tr("Create discount")}
          </button>
        </div>
      </fetcher.Form>
      <p className="wa-muted">{tr("Applies to all products and all customers. Can be combined with free shipping offers, not with other discounts.")}</p>
    </Card>
  );
}

export default function Discounts() {
  const tr = useT();
  const { discounts, bannerCode } = useLoaderData();
  return (
    <Page title={tr("Discounts")} subtitle={tr("Create discount codes in your Shopify store and show them in the discount banner. Shoppers apply them in one tap.")}>
      <CreateForm />
      <Card title={tr("Your codes")}>
        {discounts.length === 0 ? (
          <EmptyState title={tr("No codes yet")}>{tr("Codes you create here also appear in Shopify admin → Discounts.")}</EmptyState>
        ) : (
          <table className="wa-table">
            <thead><tr><th>{tr("Code")}</th><th>{tr("Offer")}</th><th>{tr("Orders")}</th><th>{tr("Status")}</th><th className="wa-right">{tr("Actions")}</th></tr></thead>
            <tbody>
              {discounts.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong className="wa-code">{d.code}</strong>
                    {bannerCode === d.code && <div><span className="wa-badge wa-badge--info">{tr("In banner")}</span></div>}
                    {bannerCode === d.code && !d.active && <p className="wa-warn">{tr("Paused but still in the banner: shoppers will see a code that doesn't work.")}</p>}
                  </td>
                  <td>
                    {d.kind === "percentage" ? tr("{value}% off", { value: d.value }) : tr("{amount} off", { amount: tr.money(d.value, "INR") })}
                    <div className="wa-muted">
                      {[
                        d.minSubtotal ? tr("min. {amount}", { amount: tr.money(d.minSubtotal, "INR") }) : null,
                        d.oncePerCustomer ? tr("once per customer") : null,
                        d.endsAt ? tr("ends {date}", { date: tr.date(d.endsAt, { day: "numeric", month: "short", year: "numeric" }) }) : null,
                      ].filter(Boolean).join(" · ") || tr("No limits")}
                    </div>
                  </td>
                  <td>{d.uses}</td>
                  <td><span className={`wa-badge wa-badge--${d.active ? "success" : "neutral"}`}>{d.active ? tr("Active") : tr("Paused")}</span></td>
                  <td className="wa-right">
                    <div className="wa-actions">
                      {d.active
                        ? <ActionButton intent="deactivate" id={d.id}>{tr("Pause")}</ActionButton>
                        : <ActionButton intent="activate" id={d.id}>{tr("Activate")}</ActionButton>}
                      <ActionButton intent="delete" id={d.id} tone="critical" confirmText={tr("Delete {code}? It stops working in your store immediately.", { code: d.code })}>{tr("Delete")}</ActionButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
