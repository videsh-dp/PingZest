import { Link, useLoaderData, useSearchParams } from "react-router";
import { hasFeature, planOf } from "../lib/plans.js";
import { REASONS } from "../lib/risk.js";
import { riskTeaser } from "../models/risk.server";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { listTemplates } from "../models/templates.server";
import { codQueue, markCodSent, markCodReminded, setCodStatus, logSend } from "../models/orders.server";
import { applyCodOutcome, expireOrder, cancelInShopify, releaseCodHold, holdCodOrder, retryAction, dismissActionError } from "../models/cod-loop.server";
import { canCancelInShopify, nextStep, reminderWhere, isExpiryDue, parseActionError, ACTION_LABELS } from "../lib/cod-loop.js";
import { COD_FILTERS } from "../lib/cod-filters.js";
import { codRowData, templatesFor, pickLang } from "../models/messages.server";
import { formatMoney } from "../lib/orders.js";
import { useT } from "../i18n/react.jsx";

import prisma from "../db.server";
import { toId } from "../lib/ids.js";
import { N_ } from "../i18n/core.js";
import {
  Page, Card, Tabs, StatusBadge, SendButton, ActionButton, MessagePreview, EmptyState,
  useQueueTemplate, ListView, SendWith,
} from "../components/ui";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") || "todo";
  const settings = await getSettings(shop);
  const pro = hasFeature(planOf(settings), "codRisk");
  const risk = pro && ["high", "medium", "low"].includes(url.searchParams.get("risk")) ? url.searchParams.get("risk") : null;
  const [templates, rows, counts, remindCount, teaser] = await Promise.all([
    listTemplates(shop),
    codQueue(shop, filter, { risk, settings }),
    prisma.order.groupBy({ by: ["codStatus"], where: { shop, isCod: true }, _count: { _all: true } }),
    prisma.order.count({ where: { shop, ...reminderWhere(settings) } }),
    pro ? null : riskTeaser(shop),
  ]);
  // The To remind tab sends the reminder message; every other tab the confirmation.
  const templateType = filter === "remind" ? "cod_reminder" : "cod_confirm";
  const now = new Date();
  const lang = pickLang(request, settings);
  const countBy = Object.fromEntries(counts.map((c) => [c.codStatus, c._count._all]));
  return {
    lang,
    pro,
    risk,
    teaser,
    templateType,
    autoExpire: Boolean(settings.codAutoExpire) && pro,
    holdOn: Boolean(settings.codHold),
    templates: templatesFor(templates, templateType),
    langs: [...new Set(templates.filter((t) => t.type === templateType).map((t) => t.lang))],
    counts: {
      todo: countBy.pending || 0, waiting: countBy.sent || 0, remind: remindCount, confirmed: countBy.confirmed || 0,
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
      held: Boolean(o.heldAt && !o.holdReleasedAt),
      remindedAt: o.codRemindedAt,
      expired: Boolean(o.codExpiredAt),
      expiryDue: isExpiryDue(o, settings, now),
      next: nextStep(o, settings),
      shopifyCancelled: Boolean(o.shopifyCancelledAt),
      canCancel: canCancelInShopify(o),
      shipped: Boolean(o.shippedAt),
      actionError: o.actionError ? parseActionError(o.actionError) : null,
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
  if (form.intent === "reminded") {
    await markCodReminded(shop, id);
    await logSend(shop, { kind: "cod_reminder", refId: id, templateId: toId(form.templateId), templateName: form.templateName, lang: form.lang });
    return { ok: true };
  }
  const settings = await getSettings(shop);
  const order = await prisma.order.findFirst({ where: { id, shop, isCod: true } });
  if (!order) return { error: "Not found" };
  if (form.intent === "status") {
    // "No reply" is expiring the order by hand (tag + the opt-in cancel, like the autopilot).
    if (form.status === "no_reply") {
      await expireOrder(order, admin, settings, "merchant");
      return { ok: true };
    }
    const updated = await setCodStatus(shop, id, form.status, "merchant");
    await applyCodOutcome(updated, { status: form.status, by: "merchant" }, admin, settings);
    return { ok: true };
  }
  if (form.intent === "cancelShopify") return cancelInShopify(order, admin, settings);
  if (form.intent === "release") {
    await releaseCodHold(order, admin);
    return { ok: true };
  }
  if (form.intent === "hold") {
    await holdCodOrder({ ...order, heldAt: null }, admin, { ...settings, codHold: true });
    return { ok: true };
  }
  if (form.intent === "retry") {
    await retryAction(order, admin, settings);
    return { ok: true };
  }
  if (form.intent === "dismissError") {
    await dismissActionError(shop, id);
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
  const { rows, counts, lang, templates, langs, pro, risk, teaser, autoExpire, holdOn } = useLoaderData();
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
  const canSend = ["todo", "waiting", "remind", "no_reply"].includes(filter);
  const reminding = filter === "remind";
  const list = rows.map((row) => ({ ...row, ...compose(row) }));

  const columns = [
    {
      key: "order", label: tr("Order"), primary: true,
      render: (r) => (<><strong>{r.orderName}</strong><div className="wa-muted">{tr.ago(r.createdAt)} · {r.amount}</div></>),
    },
    {
      key: "customer", label: tr("Customer"),
      render: (r) => (
        <>
          {r.customerName || "—"}
          <div className="wa-muted">{r.phoneDisplay ? <bdi dir="ltr">{r.phoneDisplay}</bdi> : tr("No phone")}{r.optIn ? ` · ${tr("opted in")}` : ""}</div>
          <MessagePreview message={r.message} missing={r.missing} warning={r.warning} />
        </>
      ),
    },
    {
      key: "status", label: tr("Status"),
      render: (r) => (
        <>
          <StatusBadge status={r.status} />
          {r.risk && <RiskBadge risk={r.risk} />}
          {r.paidOnline && <div><span className="wa-badge wa-badge--success">{tr("Paid online")}</span></div>}
          {r.addressFixed && <div className="wa-muted">{tr("Address updated by customer")}</div>}
          {r.sentAt && r.status === "sent" && <div className="wa-muted">{tr("sent {when}", { when: tr.ago(r.sentAt) })}</div>}
          {r.remindedAt && r.status === "sent" && <div className="wa-muted">{tr("reminded {when}", { when: tr.ago(r.remindedAt) })}</div>}
          {r.respondedBy === "customer" && <div className="wa-muted">{tr("by customer")}</div>}
          {r.expired && r.status === "no_reply" && <div className="wa-muted">{tr("expired without a reply")}</div>}
          {r.status === "sent" && r.expiryDue && <div><span className="wa-badge wa-badge--attention">{tr("Expiry due")}</span></div>}
          {r.status === "sent" && !r.expiryDue && r.next && (
            <div className="wa-muted wa-small">
              {r.next.kind === "remind" ? tr("Reminder due {when}", { when: tr.ago(r.next.at) }) : autoExpire ? tr("Expires automatically {when}", { when: tr.ago(r.next.at) }) : tr("Expiry due {when}", { when: tr.ago(r.next.at) })}
            </div>
          )}
          {r.held && <div><span className="wa-badge wa-badge--info">{tr("Fulfillment on hold")}</span></div>}
          {r.shopifyCancelled && <div><span className="wa-badge wa-badge--neutral">{tr("Cancelled in Shopify")}</span></div>}
          {r.actionError && (
            <div className="wa-error wa-small" role="alert">
              {tr(ACTION_LABELS[r.actionError.kind] || ACTION_LABELS.other)}: {r.actionError.message}
            </div>
          )}
        </>
      ),
    },
    {
      key: "actions", label: tr("Actions"), align: "right",
      render: (r) => (
        <div className="wa-actions">
          {reminding && r.status === "sent" ? (
            <SendButton link={r.link} intent="reminded" id={r.id} extra={sendExtra} label={tr("Send reminder")} />
          ) : (r.status === "pending" || r.status === "sent" || r.status === "no_reply") && (
            <SendButton link={r.link} intent="sent" id={r.id} extra={sendExtra} label={r.status === "pending" ? tr("Send on WhatsApp") : tr("Send again")} />
          )}
          {r.status !== "confirmed" && <ActionButton intent="status" id={r.id} extra={{ status: "confirmed" }}>{tr("Mark confirmed")}</ActionButton>}
          {r.status !== "cancelled" && (
            <ActionButton intent="status" id={r.id} extra={{ status: "cancelled" }} tone="critical" confirmText={tr("Mark this order as cancelled by the customer?")}>{tr("Cancelled")}</ActionButton>
          )}
          {r.status === "sent" && (
            <ActionButton intent="status" id={r.id} extra={{ status: "no_reply" }} confirmText={r.expiryDue ? null : tr("Expire this order now? It moves to No reply and gets the no-reply tag.")}>
              {r.expiryDue ? tr("Expire now") : tr("No reply")}
            </ActionButton>
          )}
          {r.canCancel && (
            <ActionButton intent="cancelShopify" id={r.id} tone="critical" confirmText={tr("Cancel this order in Shopify? Items go back in stock if that's on in Settings. The customer isn't emailed.")}>
              {tr("Cancel in Shopify")}
            </ActionButton>
          )}
          {r.held && ["pending", "sent"].includes(r.status) && <ActionButton intent="release" id={r.id}>{tr("Release hold")}</ActionButton>}
          {holdOn && !r.held && !r.shipped && ["pending", "sent"].includes(r.status) && <ActionButton intent="hold" id={r.id}>{tr("Hold fulfillment")}</ActionButton>}
          {r.actionError && <ActionButton intent="retry" id={r.id}>{tr("Retry")}</ActionButton>}
          {r.actionError && <ActionButton intent="dismissError" id={r.id}>{tr("Dismiss")}</ActionButton>}
        </div>
      ),
    },
  ];

  return (
    <Page
      title={tr("COD confirmation")}
      subtitle={tr("Confirm Cash on Delivery orders before you ship. Customers tap the link in the message to confirm or cancel.")}
      tabs={<Tabs tabs={tabs} label={tr("COD orders")} />}
    >
      {pro ? null : teaser?.high > 0 ? (
        <div className="wa-banner wa-banner--warning">
          {tr.plural("{count} COD order in the last 30 days looked risky.", "{count} COD orders in the last 30 days looked risky.", teaser.high)}{" "}
          <Link to="/app/plan">{tr("See which ones with Pro")}</Link>
        </div>
      ) : null}
      <Card className="wa-card--list">
        <ListView
          rows={list}
          columns={columns}
          caption={tr("COD orders")}
          searchText={(r) => `${r.orderName} ${r.customerName} ${r.phoneDisplay || ""}`}
          searchPlaceholder={tr("Search orders, customers or phone numbers")}
          toolbar={
            <>
              {pro && (
                <div className="wa-row-gap wa-risk-filter" role="group" aria-label={tr("Risk")}>
                  <Link className={!risk ? "wa-chip is-active" : "wa-chip"} to={riskLink(null)}>{tr("All")}</Link>
                  {["high", "medium", "low"].map((l) => (
                    <Link key={l} className={risk === l ? "wa-chip is-active" : "wa-chip"} to={riskLink(l)}>{tr(RISK_LABELS[l])}</Link>
                  ))}
                </div>
              )}
              {canSend && <SendWith templates={forLang} chosen={chosen} lang={lang} langs={langs} />}
            </>
          }
          empty={
            <EmptyState icon={filter === "todo" || reminding ? "🎉" : "✓"} title={filter === "todo" || reminding ? tr("All caught up 🎉") : tr("Nothing here yet")}>
              {filter === "todo" ? tr("New COD orders appear here automatically.") : reminding ? tr("Orders waiting longer than the reminder time (Settings → Orders) appear here.") : null}
            </EmptyState>
          }
        />
      </Card>
      <p className="wa-muted wa-footnote">
        {tr("Confirmed, cancelled and unanswered orders get the tags set in Settings, so you can filter them in Shopify Orders. PingZest cancels an order in Shopify only when you press Cancel in Shopify, or automatically if you turned that on (Pro).")}{" "}
        <Link to="/app/settings?tab=orders">{tr("COD follow-up settings")}</Link>
      </p>
    </Page>
  );
}
