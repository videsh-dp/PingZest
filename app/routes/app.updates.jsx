import { useLoaderData, useRouteLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { listTemplates } from "../models/templates.server";
import { updatesQueue, markUpdateSent, markDelivered, logSend } from "../models/orders.server";
import { updateRowData, templatesFor, pickLang } from "../models/messages.server";
import { useT } from "../i18n/react.jsx";

import { Page, Card, Tabs, SendButton, ActionButton, MessagePreview, EmptyState, useQueueTemplate, ListView, SendWith } from "../components/ui";
import { toId } from "../lib/ids.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const filter = new URL(request.url).searchParams.get("filter") || "shipped";
  const [settings, templates, rows] = await Promise.all([getSettings(shop), listTemplates(shop), updatesQueue(shop, filter)]);
  const lang = pickLang(request, settings);
  const kind = filter === "delivered" ? "delivered" : "shipped";
  return {
    lang,
    filter,
    templates: templatesFor(templates, kind),
    langs: [...new Set(templates.filter((t) => t.type === kind).map((t) => t.lang))],
    rows: rows.map((o) => ({
      id: o.id,
      orderName: o.orderName,
      customerName: o.customerName,
      trackingUrl: o.trackingUrl,
      shippedAt: o.shippedAt,
      deliveredAt: o.deliveredAt,
      shippedMsgSentAt: o.shippedMsgSentAt,
      deliveredMsgSentAt: o.deliveredMsgSentAt,
      ...updateRowData(o, settings),
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
    await markUpdateSent(session.shop, id, form.kind);
    await logSend(session.shop, { kind: form.kind === "delivered" ? "delivered" : "shipped", refId: id, templateId, templateName: form.templateName, lang: form.lang });
  }
  if (form.intent === "delivered") await markDelivered(session.shop, id);
  return { ok: true };
};

export default function Updates() {
  const tr = useT();
  const { rows, lang, filter, templates, langs } = useLoaderData();
  const counts = useRouteLoaderData("routes/app")?.counts || {};
  const { chosen, forLang, compose } = useQueueTemplate(templates, lang);
  const sendExtra = { templateId: chosen?.id ?? "", templateName: chosen?.name ?? "", lang };
  const [params] = useSearchParams();
  const current = params.get("filter") || "shipped";
  const tabs = [
    { id: "shipped", label: tr("Shipped"), count: counts.shipped },
    { id: "delivered", label: tr("Delivered"), count: counts.delivered },
    { id: "done", label: tr("Sent") },
  ];
  const columns = [
    {
      key: "order", label: tr("Order"), primary: true,
      render: (r) => (
        <>
          <strong>{r.orderName}</strong>
          <div className="wa-muted">
            {filter === "delivered" ? tr("delivered {when}", { when: tr.ago(r.deliveredAt) }) : tr("shipped {when}", { when: tr.ago(r.shippedAt) })}
          </div>
        </>
      ),
    },
    {
      key: "customer", label: tr("Customer"),
      render: (r) => (
        <>
          {r.customerName || "—"}
          <div className="wa-muted"><bdi dir="ltr">{r.phoneDisplay}</bdi></div>
          <MessagePreview message={r.message} missing={r.missing} warning={r.warning} />
        </>
      ),
    },
    {
      key: "tracking", label: tr("Tracking"),
      render: (r) => (r.trackingUrl ? <a href={r.trackingUrl} target="_blank" rel="noopener noreferrer">{tr("Track")}</a> : <span className="wa-muted">{tr("No tracking link")}</span>),
    },
    {
      key: "actions", label: tr("Actions"), align: "right",
      render: (r) => (
        <div className="wa-actions">
          {filter === "shipped" && <SendButton link={r.link} intent="sent" id={r.id} extra={{ kind: "shipped", ...sendExtra }} />}
          {filter === "delivered" && <SendButton link={r.link} intent="sent" id={r.id} extra={{ kind: "delivered", ...sendExtra }} />}
          {filter === "shipped" && !r.deliveredAt && <ActionButton intent="delivered" id={r.id}>{tr("Mark delivered")}</ActionButton>}
          {filter === "done" && (
            <span className="wa-muted">
              {r.shippedMsgSentAt && tr("shipping message {when}", { when: tr.ago(r.shippedMsgSentAt) })}
              {r.deliveredMsgSentAt && ` · ${tr("delivery message {when}", { when: tr.ago(r.deliveredMsgSentAt) })}`}
            </span>
          )}
        </div>
      ),
    },
  ];
  return (
    <Page
      title={tr("Order updates")}
      subtitle={tr("Shipping and delivery messages. Orders appear here when you fulfil them in Shopify.")}
      tabs={<Tabs tabs={tabs} label={tr("Order updates")} />}
    >
      <Card className="wa-card--list">
        <ListView
          rows={rows.map((row) => ({ ...row, ...compose(row) }))}
          columns={columns}
          caption={tr("Order updates")}
          searchText={(r) => `${r.orderName} ${r.customerName} ${r.phoneDisplay || ""}`}
          searchPlaceholder={tr("Search orders, customers or phone numbers")}
          toolbar={filter !== "done" ? <SendWith templates={forLang} chosen={chosen} lang={lang} langs={langs} /> : null}
          empty={
            <EmptyState icon="📦" title={tr("Nothing to send")}>
              {current === "delivered"
                ? tr("Delivered orders appear when your courier marks them delivered, or when you mark them below in the Shipped tab.")
                : tr("Fulfil an order in Shopify to see it here.")}
            </EmptyState>
          }
        />
      </Card>
    </Page>
  );
}
