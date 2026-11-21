import { useLoaderData, useRouteLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { listTemplates } from "../models/templates.server";
import { cartQueue, markCheckoutSent, dismissCheckout, logSend } from "../models/orders.server";
import { cartRowData, templatesFor, pickLang } from "../models/messages.server";
import { formatMoney } from "../lib/orders.js";
import { useT } from "../i18n/react.jsx";

import { Page, Card, Tabs, StatusBadge, SendButton, ActionButton, MessagePreview, EmptyState, Banner, useQueueTemplate, ListView, SendWith } from "../components/ui";
import { toId } from "../lib/ids.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const filter = new URL(request.url).searchParams.get("filter") || "todo";
  const [settings, templates] = await Promise.all([getSettings(shop), listTemplates(shop)]);
  const rows = await cartQueue(shop, { delayMin: settings.abandonDelayMin, filter });
  const lang = pickLang(request, settings);
  return {
    lang,
    templates: templatesFor(templates, "abandoned_cart"),
    langs: [...new Set(templates.filter((t) => t.type === "abandoned_cart").map((t) => t.lang))],
    delay: settings.abandonDelayMin,
    rows: rows.map((c) => ({
      id: c.id,
      customerName: c.customerName,
      amount: formatMoney(c.totalPrice, c.currency),
      items: c.itemsSummary,
      status: c.recovered ? "recovered" : c.status,
      updatedAt: c.updatedAt,
      sentAt: c.sentAt,
      ...cartRowData(c, settings),
    })),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = Object.fromEntries(await request.formData());
  const id = toId(form.id);
  if (!id) return { error: "Not found" };
  if (form.intent === "sent") {
    const templateId = toId(form.templateId);
    await markCheckoutSent(session.shop, id, templateId);
    await logSend(session.shop, { kind: "abandoned_cart", refId: id, templateId, templateName: form.templateName, lang: form.lang });
  }
  if (form.intent === "dismiss") await dismissCheckout(session.shop, id);
  return { ok: true };
};

export default function Carts() {
  const tr = useT();
  const { rows, lang, delay, templates, langs } = useLoaderData();
  const counts = useRouteLoaderData("routes/app")?.counts || {};
  const { chosen, forLang, compose } = useQueueTemplate(templates, lang);
  const sendExtra = { templateId: chosen?.id ?? "", templateName: chosen?.name ?? "", lang };
  const [params] = useSearchParams();
  const filter = params.get("filter") || "todo";
  const tabs = [
    { id: "todo", label: tr("To send"), count: counts.carts },
    { id: "sent", label: tr("Sent") },
    { id: "recovered", label: tr("Recovered") },
  ];
  const columns = [
    {
      key: "customer", label: tr("Customer"), primary: true,
      render: (r) => (
        <>
          <strong>{r.customerName || "—"}</strong>
          <div className="wa-muted"><bdi dir="ltr">{r.phoneDisplay}</bdi></div>
          <MessagePreview message={r.message} missing={r.missing} warning={r.warning} />
        </>
      ),
    },
    {
      key: "cart", label: tr("Cart"),
      render: (r) => (<><strong>{r.amount}</strong><div className="wa-muted">{r.items}</div><div className="wa-muted">{tr("left {when}", { when: tr.ago(r.updatedAt) })}</div></>),
    },
    { key: "status", label: tr("Status"), render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "actions", label: tr("Actions"), align: "right",
      render: (r) => (
        <div className="wa-actions">
          {r.status === "pending" && <SendButton link={r.link} intent="sent" id={r.id} extra={sendExtra} />}
          {r.status === "pending" && <ActionButton intent="dismiss" id={r.id}>{tr("Dismiss")}</ActionButton>}
          {r.status === "sent" && <span className="wa-muted">{tr("sent {when}", { when: tr.ago(r.sentAt) })}</span>}
        </div>
      ),
    },
  ];
  return (
    <Page
      title={tr("Abandoned checkouts")}
      subtitle={tr("Shoppers who entered a phone number but didn't finish checkout in the last 7 days (after {delay} min).", { delay })}
      tabs={<Tabs tabs={tabs} label={tr("Abandoned checkouts")} />}
    >
      {filter === "todo" && (
        <Banner tone="info">
          {tr("Only message shoppers who agreed to be contacted. Cart reminders are marketing, so keep them to one per checkout.")}
        </Banner>
      )}
      <Card className="wa-card--list">
        <ListView
          rows={rows.map((row) => ({ ...row, ...compose(row) }))}
          columns={columns}
          caption={tr("Abandoned checkouts")}
          searchText={(r) => `${r.customerName} ${r.phoneDisplay || ""} ${r.items || ""}`}
          searchPlaceholder={tr("Search customers, phone numbers or products")}
          toolbar={filter === "todo" ? <SendWith templates={forLang} chosen={chosen} lang={lang} langs={langs} /> : null}
          empty={
            <EmptyState icon="🛒" title={filter === "recovered" ? tr("No recovered checkouts yet") : tr("No abandoned checkouts right now")}>
              {filter === "todo" ? tr("Checkouts show up here {delay} minutes after the shopper leaves, so they have time to finish on their own.", { delay }) : null}
            </EmptyState>
          }
        />
      </Card>
    </Page>
  );
}
