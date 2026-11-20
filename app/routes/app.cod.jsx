import { Link, useLoaderData, useSearchParams } from "react-router";
import { hasFeature, planOf } from "../lib/plans.js";
import { REASONS } from "../lib/risk.js";
import { riskTeaser } from "../models/risk.server";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { listTemplates } from "../models/templates.server";
import { codQueue, markCodSent, setCodStatus, logSend } from "../models/orders.server";
import { COD_FILTERS } from "../lib/cod-filters.js";
import { codRowData, templatesFor, pickLang } from "../models/messages.server";
import { tagOrder, removeOrderTags } from "../models/shopify-admin.server";
import { formatMoney } from "../lib/orders.js";
import { useT } from "../i18n/react.jsx";

import prisma from "../db.server";
import { toId } from "../lib/ids.js";
import { N_ } from "../i18n/core.js";
import {
  Page, Card, Tabs, LangSwitch, StatusBadge, SendButton, ActionButton, MessagePreview, EmptyState,
  useQueueTemplate, TemplatePicker,
} from "../components/ui";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") || "todo";
  const settings = await getSettings(shop);
  const pro = hasFeature(planOf(settings), "codRisk");
  const risk = pro && ["high", "medium", "low"].includes(url.searchParams.get("risk")) ? url.searchParams.get("risk") : null;
  const [templates, rows, counts, teaser] = await Promise.all([
    listTemplates(shop),
    codQueue(shop, filter, { risk }),
    prisma.order.groupBy({ by: ["codStatus"], where: { shop, isCod: true }, _count: { _all: true } }),
    pro ? null : riskTeaser(shop),
  ]);
  const lang = pickLang(request, settings);
  const countBy = Object.fromEntries(counts.map((c) => [c.codStatus, c._count._all]));
  return {
    lang,
    pro,
    risk,
    teaser,
    templates: templatesFor(templates, "cod_confirm"),
    langs: [...new Set(templates.filter((t) => t.type === "cod_confirm").map((t) => t.lang))],
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
      // Risk details are only sent to the page on Pro.
      risk: pro && o.riskLevel ? { level: o.riskLevel, score: o.riskScore, reasons: (o.riskReasons || []).slice(0, 3) } : null,
      paidOnline: o.convertedToPrepaid,
      addressFixed: Boolean(o.addressUpdatedAt),
      ...codRowData(o, settings),
    })),
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const form = Object.fromEntries(await request.formData());
  const id = toId(form.id);
  if (!id) return { error: "Not found" };

  if (form.intent === "sent") {
    const templateId = toId(form.templateId);
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

const RISK_LABELS = { high: N_("High risk"), medium: N_("Medium risk"), low: N_("Low risk") };

function RiskBadge({ risk }) {
  const tr = useT();
  return (
    <div>
      <span className={`wa-risk wa-risk--${risk.level}`} title={tr("Risk score {score}/100", { score: risk.score })}>{tr(RISK_LABELS[risk.level])}</span>
      {risk.level !== "low" && risk.reasons.length > 0 && (
        <ul className="wa-risk__why">
          {risk.reasons.filter((x) => x.code !== "phone_good").map((x) => <li key={x.code}>{tr(REASONS[x.code] || x.code, x.vars)}</li>)}
        </ul>
      )}
    </div>
  );
}

export default function CodQueue() {
  const tr = useT();
  const { rows, counts, lang, templates, langs, pro, risk, teaser } = useLoaderData();
  const { chosen, forLang, compose } = useQueueTemplate(templates, lang);
  const sendExtra = { templateId: chosen?.id ?? "", templateName: chosen?.name ?? "", lang };
  const [params] = useSearchParams();
  const filter = params.get("filter") || "todo";
  const riskLink = (level) => {
    const p = new URLSearchParams(params);
    if (level) p.set("risk", level); else p.delete("risk");
    return `?${p}`;
  };
  const tabs = Object.entries(COD_FILTERS).map(([id, f]) => ({ id, label: tr(f.label), count: counts[id] }));

  return (
    <Page
      title={tr("COD confirmation")}
      subtitle={tr("Confirm Cash on Delivery orders before you ship. Customers tap the link in the message to confirm or cancel.")}
      actions={<div className="wa-row-gap"><TemplatePicker templates={forLang} chosen={chosen} /><LangSwitch lang={lang} langs={langs} /></div>}
    >
      <Tabs tabs={tabs} />
      {pro ? (
        <div className="wa-row-gap wa-risk-filter" role="group" aria-label={tr("Risk")}>
          <span className="wa-muted wa-small">{tr("Risk")}:</span>
          <Link className={!risk ? "wa-chip is-active" : "wa-chip"} to={riskLink(null)}>{tr("All")}</Link>
          {["high", "medium", "low"].map((l) => (
            <Link key={l} className={risk === l ? "wa-chip is-active" : "wa-chip"} to={riskLink(l)}>{tr(RISK_LABELS[l])}</Link>
          ))}
        </div>
      ) : teaser?.high > 0 ? (
        <div className="wa-banner wa-banner--warning">
          {tr.plural("{count} COD order in the last 30 days looked risky.", "{count} COD orders in the last 30 days looked risky.", teaser.high)}{" "}
          <Link to="/app/plan">{tr("See which ones with Pro")}</Link>
        </div>
      ) : null}
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={filter === "todo" ? tr("All caught up 🎉") : tr("Nothing here yet")}>
            {filter === "todo" ? tr("New COD orders appear here automatically.") : null}
          </EmptyState>
        ) : (
          <table className="wa-table">
            <thead>
              <tr><th>{tr("Order")}</th><th>{tr("Customer")}</th><th>{tr("Amount")}</th><th>{tr("Status")}</th><th className="wa-right">{tr("Actions")}</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => ({ ...row, ...compose(row) })).map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.orderName}</strong>
                    <div className="wa-muted">{tr.ago(r.createdAt)}</div>
                  </td>
                  <td>
                    {r.customerName || "—"}
                    <div className="wa-muted">{r.phoneDisplay ? <bdi dir="ltr">{r.phoneDisplay}</bdi> : tr("No phone")}{r.optIn ? ` · ${tr("opted in")}` : ""}</div>
                    <MessagePreview message={r.message} missing={r.missing} warning={r.warning} />
                  </td>
                  <td>{r.amount}</td>
                  <td>
                    <StatusBadge status={r.status} />
                    {r.risk && <RiskBadge risk={r.risk} />}
                    {r.paidOnline && <div><span className="wa-badge wa-badge--success">{tr("Paid online")}</span></div>}
                    {r.addressFixed && <div className="wa-muted">{tr("Address updated by customer")}</div>}
                    {r.sentAt && r.status === "sent" && <div className="wa-muted">{tr("sent {when}", { when: tr.ago(r.sentAt) })}</div>}
                    {r.respondedBy === "customer" && <div className="wa-muted">{tr("by customer")}</div>}
                  </td>
                  <td className="wa-right">
                    <div className="wa-actions">
                      {(r.status === "pending" || r.status === "sent" || r.status === "no_reply") && (
                        <SendButton link={r.link} intent="sent" id={r.id} extra={sendExtra} label={r.status === "pending" ? tr("Send on WhatsApp") : tr("Send again")} />
                      )}
                      {r.status !== "confirmed" && <ActionButton intent="status" id={r.id} extra={{ status: "confirmed" }}>{tr("Mark confirmed")}</ActionButton>}
                      {r.status !== "cancelled" && (
                        <ActionButton intent="status" id={r.id} extra={{ status: "cancelled" }} tone="critical" confirmText={tr("Mark this order as cancelled by the customer?")}>{tr("Cancelled")}</ActionButton>
                      )}
                      {r.status === "sent" && <ActionButton intent="status" id={r.id} extra={{ status: "no_reply" }}>{tr("No reply")}</ActionButton>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="wa-muted wa-footnote">
        {tr("Confirmed and cancelled orders get the tags set in Settings, so you can filter them in Shopify Orders. PingZest doesn't cancel orders for you.")}
      </p>
    </Page>
  );
}
