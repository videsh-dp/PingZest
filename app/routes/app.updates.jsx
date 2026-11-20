import { useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { listTemplates } from "../models/templates.server";
import { updatesQueue, markUpdateSent, markDelivered, logSend } from "../models/orders.server";
import { updateRowData, templatesFor, pickLang } from "../models/messages.server";
import { Page, Card, Tabs, LangSwitch, SendButton, ActionButton, MessagePreview, EmptyState, timeAgo, useQueueTemplate, TemplatePicker } from "../components/ui";

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
  const id = Number(form.id);
  if (form.intent === "sent") {
    const templateId = form.templateId ? Number(form.templateId) : null;
    await markUpdateSent(session.shop, id, form.kind);
    await logSend(session.shop, { kind: form.kind === "delivered" ? "delivered" : "shipped", refId: id, templateId, templateName: form.templateName, lang: form.lang });
  }
  if (form.intent === "delivered") await markDelivered(session.shop, id);
  return { ok: true };
};

export default function Updates() {
  const { rows, lang, filter, templates } = useLoaderData();
  const { chosen, forLang, compose } = useQueueTemplate(templates, lang);
  const sendExtra = { templateId: chosen?.id ?? "", templateName: chosen?.name ?? "", lang };
  const [params] = useSearchParams();
  const current = params.get("filter") || "shipped";
  const tabs = [
    { id: "shipped", label: "Shipped" },
    { id: "delivered", label: "Delivered" },
    { id: "done", label: "Sent" },
  ];
  return (
    <Page
      title="Order updates"
      subtitle="Shipping and delivery messages. Orders appear here when you fulfil them in Shopify."
      actions={<div className="wa-row-gap">{filter !== "done" && <TemplatePicker templates={forLang} chosen={chosen} />}<LangSwitch lang={lang} /></div>}
    >
      <Tabs tabs={tabs} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Nothing to send">
            {current === "delivered"
              ? "Delivered orders appear when your courier marks them delivered, or when you mark them below in the Shipped tab."
              : "Fulfil an order in Shopify to see it here."}
          </EmptyState>
        ) : (
          <table className="wa-table">
            <thead><tr><th>Order</th><th>Customer</th><th>Tracking</th><th className="wa-right">Actions</th></tr></thead>
            <tbody>
              {rows.map((row) => ({ ...row, ...compose(row) })).map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.orderName}</strong>
                    <div className="wa-muted">
                      {filter === "delivered" ? `delivered ${timeAgo(r.deliveredAt)}` : `shipped ${timeAgo(r.shippedAt)}`}
                    </div>
                  </td>
                  <td>
                    {r.customerName || "—"}
                    <div className="wa-muted">{r.phoneDisplay}</div>
                    <MessagePreview message={r.message} missing={r.missing} warning={r.warning} />
                  </td>
                  <td>{r.trackingUrl ? <a href={r.trackingUrl} target="_blank" rel="noopener noreferrer">Track</a> : <span className="wa-muted">No tracking link</span>}</td>
                  <td className="wa-right">
                    <div className="wa-actions">
                      {filter === "shipped" && <SendButton link={r.link} intent="sent" id={r.id} extra={{ kind: "shipped", ...sendExtra }} />}
                      {filter === "delivered" && <SendButton link={r.link} intent="sent" id={r.id} extra={{ kind: "delivered", ...sendExtra }} />}
                      {filter === "shipped" && !r.deliveredAt && <ActionButton intent="delivered" id={r.id}>Mark delivered</ActionButton>}
                      {filter === "done" && (
                        <span className="wa-muted">
                          {r.shippedMsgSentAt && `shipped msg ${timeAgo(r.shippedMsgSentAt)}`}
                          {r.deliveredMsgSentAt && ` · delivered msg ${timeAgo(r.deliveredMsgSentAt)}`}
                        </span>
                      )}
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
