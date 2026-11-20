import { useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { listTemplates } from "../models/templates.server";
import { codQueue, COD_FILTERS, markCodSent, setCodStatus, logSend } from "../models/orders.server";
import { codRowData, templatesFor, pickLang } from "../models/messages.server";
import { tagOrder, removeOrderTags } from "../models/shopify-admin.server";
import { formatMoney } from "../lib/orders.js";
import prisma from "../db.server";
import {
  Page, Card, Tabs, LangSwitch, StatusBadge, SendButton, ActionButton, MessagePreview, EmptyState, timeAgo,
  useQueueTemplate, TemplatePicker,
} from "../components/ui";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const filter = new URL(request.url).searchParams.get("filter") || "todo";
  const [settings, templates, rows, counts] = await Promise.all([
    getSettings(shop),
    listTemplates(shop),
    codQueue(shop, filter),
    prisma.order.groupBy({ by: ["codStatus"], where: { shop, isCod: true }, _count: { _all: true } }),
  ]);
  const lang = pickLang(request, settings);
  const countBy = Object.fromEntries(counts.map((c) => [c.codStatus, c._count._all]));
  return {
    lang,
    templates: templatesFor(templates, "cod_confirm"),
    counts: {
      todo: countBy.pending || 0, waiting: countBy.sent || 0, confirmed: countBy.confirmed || 0,
      cancelled: countBy.cancelled || 0, no_reply: countBy.no_reply || 0,
    },
    rows: rows.map((o) => ({
      id: o.id,
      orderName: o.orderName,
      customerName: o.customerName,
      amount: formatMoney(o.totalPrice, o.currency),
      status: o.codStatus,
      createdAt: o.createdAt,
      sentAt: o.codSentAt,
      respondedBy: o.codRespondedBy,
      optIn: o.whatsappOptIn,
      ...codRowData(o, settings),
    })),
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const form = Object.fromEntries(await request.formData());
  const id = Number(form.id);

  if (form.intent === "sent") {
    const templateId = form.templateId ? Number(form.templateId) : null;
    await markCodSent(shop, id, templateId);
    await logSend(shop, { kind: "cod_confirm", refId: id, templateId, templateName: form.templateName, lang: form.lang });
    return { ok: true };
  }
  if (form.intent === "status") {
    const order = await setCodStatus(shop, id, form.status, "merchant");
    const settings = await getSettings(shop);
    if (order && form.status === "confirmed") {
      await tagOrder(admin, order.orderGid, [settings.confirmedTag]);
      await removeOrderTags(admin, order.orderGid, [settings.cancelledTag]);
    } else if (order && form.status === "cancelled") {
      await tagOrder(admin, order.orderGid, [settings.cancelledTag]);
      await removeOrderTags(admin, order.orderGid, [settings.confirmedTag]);
    }
    return { ok: true };
  }
  return { ok: false };
};

export default function CodQueue() {
  const { rows, counts, lang, templates } = useLoaderData();
  const { chosen, forLang, compose } = useQueueTemplate(templates, lang);
  const sendExtra = { templateId: chosen?.id ?? "", templateName: chosen?.name ?? "", lang };
  const [params] = useSearchParams();
  const filter = params.get("filter") || "todo";
  const tabs = Object.entries(COD_FILTERS).map(([id, f]) => ({ id, label: f.label, count: counts[id] }));

  return (
    <Page
      title="COD confirmation"
      subtitle="Confirm Cash on Delivery orders before you ship. Customers tap the link in the message to confirm or cancel."
      actions={<div className="wa-row-gap"><TemplatePicker templates={forLang} chosen={chosen} /><LangSwitch lang={lang} /></div>}
    >
      <Tabs tabs={tabs} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={filter === "todo" ? "All caught up 🎉" : "Nothing here yet"}>
            {filter === "todo" ? "New COD orders appear here automatically." : null}
          </EmptyState>
        ) : (
          <table className="wa-table">
            <thead>
              <tr><th>Order</th><th>Customer</th><th>Amount</th><th>Status</th><th className="wa-right">Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => ({ ...row, ...compose(row) })).map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.orderName}</strong>
                    <div className="wa-muted">{timeAgo(r.createdAt)}</div>
                  </td>
                  <td>
                    {r.customerName || "—"}
                    <div className="wa-muted">{r.phoneDisplay || "No phone"}{r.optIn ? " · opted in" : ""}</div>
                    <MessagePreview message={r.message} missing={r.missing} warning={r.warning} />
                  </td>
                  <td>{r.amount}</td>
                  <td>
                    <StatusBadge status={r.status} />
                    {r.sentAt && r.status === "sent" && <div className="wa-muted">sent {timeAgo(r.sentAt)}</div>}
                    {r.respondedBy === "customer" && <div className="wa-muted">by customer</div>}
                  </td>
                  <td className="wa-right">
                    <div className="wa-actions">
                      {(r.status === "pending" || r.status === "sent" || r.status === "no_reply") && (
                        <SendButton link={r.link} intent="sent" id={r.id} extra={sendExtra} label={r.status === "pending" ? "Send on WhatsApp" : "Send again"} />
                      )}
                      {r.status !== "confirmed" && <ActionButton intent="status" id={r.id} extra={{ status: "confirmed" }}>Mark confirmed</ActionButton>}
                      {r.status !== "cancelled" && (
                        <ActionButton intent="status" id={r.id} extra={{ status: "cancelled" }} tone="critical" confirmText="Mark this order as cancelled by the customer?">Cancelled</ActionButton>
                      )}
                      {r.status === "sent" && <ActionButton intent="status" id={r.id} extra={{ status: "no_reply" }}>No reply</ActionButton>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="wa-muted wa-footnote">
        Confirmed and cancelled orders get the tags set in Settings, so you can filter them in Shopify Orders.
        WA Assist doesn't cancel orders for you.
      </p>
    </Page>
  );
}
