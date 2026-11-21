import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { listDiscounts, createDiscount, toggleDiscount, removeDiscount } from "../models/discounts.server";
import { getWidgetConfig } from "../models/widgets.server";
import { Page, Card, Banner, EmptyState, ActionButton, ListView, TabBar, useTabState } from "../components/ui";
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

function CreateForm({ onClose }) {
  const tr = useT();
  const fetcher = useFetcher();
  const formRef = useRef(null);
  const errors = fetcher.data?.errors || {};
  const created = fetcher.state === "idle" ? fetcher.data?.discount : null;
  useEffect(() => { if (created) formRef.current?.reset(); }, [created]);

  return (
    <Card className="wa-card--panel">
      <div className="wa-row-between">
        <h2 className="wa-card__title">{tr("Create a discount code")}</h2>
        {onClose && <button type="button" className="wa-button wa-button--plain" onClick={onClose}>{tr("Close")}</button>}
      </div>
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
  const [creating, setCreating] = useState(discounts.length === 0);
  const [tab, setTab] = useTabState(["all", "active", "paused"]);
  const active = discounts.filter((d) => d.active);
  const paused = discounts.filter((d) => !d.active);
  const rows = tab === "active" ? active : tab === "paused" ? paused : discounts;
  const offer = (d) => (d.kind === "percentage" ? tr("{value}% off", { value: d.value }) : tr("{amount} off", { amount: tr.money(d.value, "INR") }));
  const limits = (d) => [
    d.minSubtotal ? tr("min. {amount}", { amount: tr.money(d.minSubtotal, "INR") }) : null,
    d.oncePerCustomer ? tr("once per customer") : null,
    d.endsAt ? tr("ends {date}", { date: tr.date(d.endsAt, { day: "numeric", month: "short", year: "numeric" }) }) : null,
  ].filter(Boolean).join(" · ") || tr("No limits");

  const columns = [
    {
      key: "code", label: tr("Code"), primary: true,
      render: (d) => (
        <>
          <strong className="wa-code">{d.code}</strong>
          {bannerCode === d.code && <div><span className="wa-badge wa-badge--info">{tr("In banner")}</span></div>}
          {bannerCode === d.code && !d.active && <p className="wa-warn">{tr("Paused but still in the banner: shoppers will see a code that doesn't work.")}</p>}
        </>
      ),
    },
    { key: "offer", label: tr("Offer"), render: (d) => (<>{offer(d)}<div className="wa-muted">{limits(d)}</div></>) },
    { key: "uses", label: tr("Orders"), render: (d) => d.uses },
    { key: "status", label: tr("Status"), render: (d) => <span className={`wa-badge wa-badge--${d.active ? "success" : "neutral"}`}>{d.active ? tr("Active") : tr("Paused")}</span> },
    {
      key: "actions", label: tr("Actions"), align: "right",
      render: (d) => (
        <div className="wa-actions">
          {d.active
            ? <ActionButton intent="deactivate" id={d.id}>{tr("Pause")}</ActionButton>
            : <ActionButton intent="activate" id={d.id}>{tr("Activate")}</ActionButton>}
          <ActionButton intent="delete" id={d.id} tone="critical" confirmText={tr("Delete {code}? It stops working in your store immediately.", { code: d.code })}>{tr("Delete")}</ActionButton>
        </div>
      ),
    },
  ];

  return (
    <Page
      title={tr("Discounts")}
      subtitle={tr("Create discount codes in your Shopify store and show them in the discount banner. Shoppers apply them in one tap.")}
      actions={!creating && <button type="button" className="wa-button wa-button--primary" onClick={() => setCreating(true)}>{tr("Create discount")}</button>}
      tabs={
        <TabBar
          label={tr("Discount codes")}
          current={tab}
          onSelect={setTab}
          tabs={[
            { id: "all", label: tr("All"), count: discounts.length },
            { id: "active", label: tr("Active"), count: active.length },
            { id: "paused", label: tr("Paused"), count: paused.length },
          ]}
        />
      }
    >
      {creating && <CreateForm onClose={discounts.length ? () => setCreating(false) : null} />}
      <Card className="wa-card--list">
        <ListView
          rows={rows}
          columns={columns}
          caption={tr("Your codes")}
          searchText={(d) => `${d.code} ${d.title || ""}`}
          searchPlaceholder={tr("Search codes")}
          empty={
            <EmptyState icon="％" title={discounts.length ? tr("Nothing here yet") : tr("No codes yet")}>
              {tr("Codes you create here also appear in Shopify admin → Discounts.")}
            </EmptyState>
          }
        />
      </Card>
    </Page>
  );
}
