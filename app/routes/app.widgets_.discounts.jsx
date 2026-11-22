import { Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { listDiscounts, createDiscount, toggleDiscount, removeDiscount } from "../models/discounts.server";
import { getWidgetConfig } from "../models/widgets.server";
import { Page, Card, Badge, EmptyState, ActionButton, ListView, TabBar, useTabState } from "../components/ui";
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

export default function Discounts() {
  const tr = useT();
  const { discounts, bannerCode } = useLoaderData();
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
          {bannerCode === d.code && <div><Badge tone="info">{tr("In banner")}</Badge></div>}
          {bannerCode === d.code && !d.active && <p className="wa-warn">{tr("Paused but still in the banner: shoppers will see a code that doesn't work.")}</p>}
        </>
      ),
    },
    { key: "offer", label: tr("Offer"), render: (d) => (<>{offer(d)}<div className="wa-muted">{limits(d)}</div></>) },
    { key: "uses", label: tr("Orders"), render: (d) => d.uses },
    { key: "status", label: tr("Status"), render: (d) => <Badge tone={d.active ? "success" : "neutral"}>{d.active ? tr("Active") : tr("Paused")}</Badge> },
    {
      key: "actions", label: tr("Actions"), align: "right",
      render: (d) => (
        <div className="wa-actions">
          {d.active
            ? <ActionButton intent="deactivate" id={d.id}>{tr("Pause")}</ActionButton>
            : <ActionButton intent="activate" id={d.id}>{tr("Activate")}</ActionButton>}
          <ActionButton intent="delete" id={d.id} tone="critical" confirmTitle={tr("Delete {code}?", { code: d.code })} confirmText={tr("It stops working in your store immediately, and shoppers who have it can no longer use it.")}>{tr("Delete")}</ActionButton>
        </div>
      ),
    },
  ];

  return (
    <Page
      title={tr("Discounts")}
      backTo={{ to: "/app/widgets", label: tr("Widgets") }}
      subtitle={tr("Create discount codes in your Shopify store and show them in the discount banner. Shoppers apply them in one tap.")}
      size="large"
      primaryAction={{ label: tr("Create discount"), to: "/app/widgets/discounts/new" }}
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
      <Card className="wa-card--list">
        <ListView
          rows={rows}
          columns={columns}
          caption={tr("Your codes")}
          searchText={(d) => `${d.code} ${d.title || ""}`}
          searchPlaceholder={tr("Search codes")}
          empty={
            <EmptyState title={discounts.length ? tr("Nothing here yet") : tr("No codes yet")} action={discounts.length ? null : <Link className="wa-button wa-button--primary" to="/app/widgets/discounts/new">{tr("Create discount")}</Link>}>
              {tr("Codes you create here also appear in Shopify admin → Discounts.")}
            </EmptyState>
          }
        />
      </Card>
    </Page>
  );
}
