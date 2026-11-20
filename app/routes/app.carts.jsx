import { useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { listTemplates } from "../models/templates.server";
import { cartQueue, markCheckoutSent, dismissCheckout, logSend } from "../models/orders.server";
import { cartRowData, templatesFor, pickLang } from "../models/messages.server";
import { formatMoney } from "../lib/orders.js";
import { useT } from "../i18n/react.jsx";

import { Page, Card, Tabs, LangSwitch, StatusBadge, SendButton, ActionButton, MessagePreview, EmptyState, Banner, useQueueTemplate, TemplatePicker } from "../components/ui";
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
  const { chosen, forLang, compose } = useQueueTemplate(templates, lang);
  const sendExtra = { templateId: chosen?.id ?? "", templateName: chosen?.name ?? "", lang };
  const [params] = useSearchParams();
  const filter = params.get("filter") || "todo";
  const tabs = [
    { id: "todo", label: tr("To send") },
    { id: "sent", label: tr("Sent") },
    { id: "recovered", label: tr("Recovered") },
  ];
  return (
    <Page
      title={tr("Abandoned checkouts")}
      subtitle={tr("Shoppers who entered a phone number but didn't finish checkout in the last 7 days (after {delay} min).", { delay })}
      actions={<div className="wa-row-gap"><TemplatePicker templates={forLang} chosen={chosen} /><LangSwitch lang={lang} langs={langs} /></div>}
    >
      <Banner tone="info">
        {tr("Only message shoppers who agreed to be contacted. Cart reminders are marketing, so keep them to one per checkout.")}
      </Banner>
      <Tabs tabs={tabs} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={filter === "recovered" ? tr("No recovered checkouts yet") : tr("No abandoned checkouts right now")} />
        ) : (
          <table className="wa-table">
            <thead><tr><th>{tr("Customer")}</th><th>{tr("Cart")}</th><th>{tr("Status")}</th><th className="wa-right">{tr("Actions")}</th></tr></thead>
            <tbody>
              {rows.map((row) => ({ ...row, ...compose(row) })).map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.customerName || "—"}
                    <div className="wa-muted"><bdi dir="ltr">{r.phoneDisplay}</bdi></div>
                    <MessagePreview message={r.message} missing={r.missing} warning={r.warning} />
                  </td>
                  <td>
                    <strong>{r.amount}</strong>
                    <div className="wa-muted">{r.items}</div>
                    <div className="wa-muted">{tr("left {when}", { when: tr.ago(r.updatedAt) })}</div>
                  </td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="wa-right">
                    <div className="wa-actions">
                      {r.status === "pending" && <SendButton link={r.link} intent="sent" id={r.id} extra={sendExtra} />}
                      {r.status === "pending" && <ActionButton intent="dismiss" id={r.id}>{tr("Dismiss")}</ActionButton>}
                      {r.status === "sent" && <span className="wa-muted">{tr("sent {when}", { when: tr.ago(r.sentAt) })}</span>}
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
