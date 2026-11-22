import { useEffect, useMemo, useState } from "react";
import { Link, useFetcher, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { hasFeature, planOf } from "../lib/plans.js";
import { REASONS } from "../lib/risk.js";
import { riskTeaser } from "../models/risk.server";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { listTemplates } from "../models/templates.server";
import { codQueue, markCodSent, markCodReminded, setCodStatus, logSend } from "../models/orders.server";
import { applyCodOutcome, expireOrder, cancelInShopify, releaseCodHold, holdCodOrder, retryAction, dismissActionError } from "../models/cod-loop.server";
import { canCancelInShopify, nextStep, reminderWhere, isExpiryDue, parseActionError, ACTION_LABELS } from "../lib/cod-loop.js";
import { COD_FILTERS, COD_MAIN_TABS, COD_SORTS, sortCodRows, nextToSend } from "../lib/cod-filters.js";
import { loopTimers } from "../lib/cod-loop.js";
import { codRowData, templatesFor, pickLang } from "../models/messages.server";
import { markRto } from "../models/rto.server";
import { formatMoney } from "../lib/orders.js";
import { useT } from "../i18n/react.jsx";

import prisma from "../db.server";
import { toId } from "../lib/ids.js";
import { N_ } from "../i18n/core.js";
import {
  Page, Card, Banner, Tabs, StatusBadge, Badge, SendButton, ActionButton, ActionMenu, MessagePreview, EmptyState,
  useQueueTemplate, ListView, SendWith, WhatsAppIcon,
} from "../components/ui";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") || "todo";
  const settings = await getSettings(shop);
  const pro = hasFeature(planOf(settings), "codRisk");
  const risk = pro && ["high", "medium", "low"].includes(url.searchParams.get("risk")) ? url.searchParams.get("risk") : null;
  const sortParam = url.searchParams.get("sort");
  const sort = COD_SORTS[sortParam] && (sortParam !== "risk" || pro) ? sortParam : filter === "todo" || filter === "remind" ? "oldest" : "newest";
  const [templates, unsorted, counts, remindCount, teaser] = await Promise.all([
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
  const rows = sortCodRows(unsorted, sort);
  const { remindHours, expireHours } = loopTimers(settings);
  return {
    sort,
    shop,
    rules: { hold: Boolean(settings.codHold), remindHours, expireHours, autoExpire: Boolean(settings.codAutoExpire) && pro, cancelOnExpire: Boolean(settings.cancelOnExpire) && pro, confirmedTag: settings.confirmedTag },
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
      items: o.itemsSummary,
      pincode: o.pincode,
      shopifyOrderId: o.shopifyOrderId,
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
      rto: Boolean(o.rtoAt),
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
    // An order cancelled in Shopify is final: confirming it again would tag a cancelled order and release its hold.
    if (order.shopifyCancelledAt) return { error: "This order was cancelled in Shopify." };
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
  if (form.intent === "rto") {
    await markRto(shop, id, form.on === "1");
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


/** Keyboard shortcuts on desktop: S send & next, J/K move between orders, C mark the selected one confirmed. */
function useShortcuts({ rows, sendNext, selected, setSelected, confirmSelected }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (document.querySelector("dialog[open]")) return;
      const k = e.key.toLowerCase();
      const at = rows.findIndex((r) => r.id === selected);
      if (k === "j" || k === "k") {
        e.preventDefault();
        const next = rows[Math.min(rows.length - 1, Math.max(0, at + (k === "j" ? 1 : -1)))] || rows[0];
        if (next) setSelected(next.id);
      } else if (k === "s") {
        e.preventDefault();
        sendNext();
      } else if (k === "c" && selected) {
        e.preventDefault();
        confirmSelected(selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, sendNext, selected, setSelected, confirmSelected]);
}

export default function CodQueue() {
  const tr = useT();
  const { rows, counts, lang, templates, langs, pro, risk, teaser, rules, sort, shop } = useLoaderData();
  const { chosen, forLang, compose } = useQueueTemplate(templates, lang);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const filter = params.get("filter") || "todo";
  const reminding = filter === "remind";
  const sendExtra = { templateId: chosen?.id ?? "", templateName: chosen?.name ?? "", lang };
  const link = (patch) => {
    const p = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    return `?${p}`;
  };
  const tabs = Object.entries(COD_FILTERS).map(([id, f]) => ({ id, label: tr(f.label), count: counts[id] }));
  const canSend = ["todo", "waiting", "remind", "no_reply"].includes(filter);
  const list = useMemo(() => rows.map((row) => ({ ...row, ...compose(row) })), [rows, compose]);

  // "Send & next": open WhatsApp for the next order in the list, record it, move on.
  const runMode = filter === "todo" || reminding;
  const [done, setDone] = useState(() => new Set());
  const [sentCount, setSentCount] = useState(0);
  const [selected, setSelected] = useState(null);
  const sender = useFetcher({ key: "cod-send-next" });
  const confirmer = useFetcher({ key: "cod-confirm-key" });
  const next = runMode ? nextToSend(list.filter((r) => !r.shopifyCancelled && (!reminding || r.status === "sent")), done) : null;
  const remaining = runMode ? list.filter((r) => r.link && !done.has(r.id) && !r.shopifyCancelled).length : 0;
  useEffect(() => { setDone(new Set()); setSentCount(0); }, [filter]);
  const recordNext = () => {
    if (!next) return;
    sender.submit({ intent: reminding ? "reminded" : "sent", id: String(next.id), ...sendExtra }, { method: "post" });
    setDone((d) => new Set(d).add(next.id));
    setSentCount((n) => n + 1);
    setSelected(next.id);
  };
  const sendNext = () => { if (next?.link) { window.open(next.link, "_blank", "noopener"); recordNext(); } };
  const confirmSelected = (id) => confirmer.submit({ intent: "status", id: String(id), status: "confirmed" }, { method: "post" });
  useShortcuts({ rows: list, sendNext, selected, setSelected, confirmSelected });
  useEffect(() => {
    if (selected) document.querySelector(`[data-row="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // In the page, not the admin's title bar: it has to open WhatsApp straight from the merchant's tap.
  const runBar = runMode && list.length > 0 && (
    <div className="wa-runbar" data-runbar>
      {next ? (
        <a
          href={next.link}
          target="_blank"
          rel="noopener noreferrer"
          className="wa-button wa-button--primary wa-sendnext"
          onClick={recordNext}
          data-send-next={next.id}
          aria-keyshortcuts="S"
        >
          <WhatsAppIcon /> {reminding ? tr("Remind next: {order}", { order: next.orderName }) : tr("Send next: {order}", { order: next.orderName })}
        </a>
      ) : <span className="wa-muted" data-send-next="done">{tr("Everything in this list is sent")}</span>}
      <span className="wa-muted wa-small" data-run-progress={sentCount > 0 ? "" : undefined}>
        {sentCount > 0 ? tr("{sent} sent in this run · {left} left", { sent: sentCount, left: remaining }) : tr("Opens WhatsApp for the oldest order, then moves to the next one.")}
      </span>
    </div>
  );

  const columns = [
    {
      key: "order", label: tr("Order"), primary: true,
      render: (r) => {
        const late = r.status === "pending" && Date.now() - new Date(r.createdAt).getTime() > rules.remindHours * 3600e3;
        return (
          <>
            <Link to={`/app/cod/${r.id}`} className="wa-order-link"><strong>{r.orderName}</strong></Link>
            <div><strong className="wa-amount">{r.amount}</strong> · <span className={late ? "wa-late" : "wa-muted"}>{tr.ago(r.createdAt)}</span></div>
            {r.items && <div className="wa-muted wa-small wa-clamp">{r.items}</div>}
            {r.pincode && <div className="wa-muted wa-small">{tr("PIN {pincode}", { pincode: r.pincode })}</div>}
          </>
        );
      },
    },
    {
      key: "customer", label: tr("Customer"),
      render: (r) => (
        <>
          {r.customerName || "—"}
          <div className="wa-muted">{r.phoneDisplay ? <bdi dir="ltr">{r.phoneDisplay}</bdi> : tr("No phone")}{r.optIn ? ` · ${tr("opted in")}` : ""}</div>
          {!r.phoneDisplay && (
            <div className="wa-warn wa-small">
              {tr("No valid WhatsApp number on this order. Call the customer, or check the default country code in")} <Link to="/app/settings">{tr("Settings")}</Link>.
            </div>
          )}
          <MessagePreview message={r.message} missing={r.missing} warning={r.warning} />
        </>
      ),
    },
    {
      key: "status", label: tr("Status"),
      render: (r) => (
        <>
          {r.shopifyCancelled ? <Badge>{tr("Cancelled in Shopify")}</Badge>
            : r.rto ? <Badge tone="critical">{tr("Returned (RTO)")}</Badge>
            : r.status === "sent" && r.expiryDue ? <Badge tone="warning">{tr("Expiry due")}</Badge>
            : <StatusBadge status={r.status} />}
          {r.risk && <RiskBadge risk={r.risk} />}
          {r.paidOnline && <div className="wa-success wa-small">{tr("Paid online")}</div>}
          {r.held && <div className="wa-muted wa-small">{tr("Fulfillment on hold")}</div>}
          {r.addressFixed && <div className="wa-muted wa-small">{tr("Address updated by customer")}</div>}
          {r.sentAt && r.status === "sent" && <div className="wa-muted wa-small">{tr("sent {when}", { when: tr.ago(r.sentAt) })}</div>}
          {r.remindedAt && r.status === "sent" && <div className="wa-muted wa-small">{tr("reminded {when}", { when: tr.ago(r.remindedAt) })}</div>}
          {r.respondedBy === "customer" && <div className="wa-muted wa-small">{tr("by customer")}</div>}
          {r.expired && r.status === "no_reply" && <div className="wa-muted wa-small">{tr("expired without a reply")}</div>}
          {r.status === "sent" && !r.expiryDue && r.next && (
            <div className="wa-muted wa-small">
              {r.next.kind === "remind" ? tr("Reminder due {when}", { when: tr.ago(r.next.at) }) : rules.autoExpire ? tr("Expires automatically {when}", { when: tr.ago(r.next.at) }) : tr("Expiry due {when}", { when: tr.ago(r.next.at) })}
            </div>
          )}
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
      render: (r) => {
        const send = r.shopifyCancelled ? null : reminding && r.status === "sent"
          ? <SendButton link={r.link} intent="reminded" id={r.id} extra={sendExtra} label={tr("Send reminder")} />
          : (r.status === "pending" || r.status === "sent" || r.status === "no_reply")
            ? <SendButton link={r.link} intent="sent" id={r.id} extra={sendExtra} label={r.status === "pending" ? tr("Send on WhatsApp") : tr("Send again")} />
            : null;
        const primaryFix = r.actionError ? <ActionButton intent="retry" id={r.id}>{tr("Retry")}</ActionButton>
          : r.status === "sent" && r.expiryDue ? <ActionButton intent="status" id={r.id} extra={{ status: "no_reply" }}>{tr("Expire now")}</ActionButton>
          : null;
        return (
          <div className="wa-actions">
            {primaryFix}
            {send}
            <ActionMenu>
              {r.status !== "confirmed" && !r.shopifyCancelled && <ActionButton key="c" intent="status" id={r.id} extra={{ status: "confirmed" }}>{tr("Mark confirmed")}</ActionButton>}
              {r.status !== "cancelled" && !r.shopifyCancelled && (
                <ActionButton key="x" intent="status" id={r.id} extra={{ status: "cancelled" }} tone="critical" confirmTitle={tr("Mark cancelled?")} confirmLabel={tr("Mark cancelled")} confirmText={tr("Mark this order as cancelled by the customer?")}>{tr("Mark cancelled")}</ActionButton>
              )}
              {r.status === "sent" && !r.expiryDue && (
                <ActionButton key="n" intent="status" id={r.id} extra={{ status: "no_reply" }} confirmTitle={tr("Expire this order?")} confirmLabel={tr("Expire now")} confirmText={tr("Expire this order now? It moves to No reply and gets the no-reply tag.")}>{tr("No reply")}</ActionButton>
              )}
              {r.canCancel && (
                <ActionButton key="s" intent="cancelShopify" id={r.id} tone="critical" confirmTitle={tr("Cancel in Shopify?")} confirmLabel={tr("Cancel order")} confirmText={tr("Cancel this order in Shopify? Items go back in stock if that's on in Settings. The customer isn't emailed.")}>
                  {tr("Cancel in Shopify")}
                </ActionButton>
              )}
              {r.held && ["pending", "sent"].includes(r.status) && <ActionButton key="r" intent="release" id={r.id}>{tr("Release hold")}</ActionButton>}
              {rules.hold && !r.held && !r.shipped && ["pending", "sent"].includes(r.status) && <ActionButton key="h" intent="hold" id={r.id}>{tr("Hold fulfillment")}</ActionButton>}
              {["confirmed", "no_reply", "sent"].includes(r.status) && !r.shopifyCancelled && (
                r.rto
                  ? <ActionButton key="t" intent="rto" id={r.id} extra={{ on: "0" }}>{tr("Not returned")}</ActionButton>
                  : (r.shipped || r.status === "confirmed") && <ActionButton key="t" intent="rto" id={r.id} extra={{ on: "1" }} confirmTitle={tr("Mark as returned?")} confirmLabel={tr("Returned (RTO)")} confirmText={tr("Mark this parcel as returned to you (RTO)? It counts in Analytics → Returns.")}>{tr("Returned (RTO)")}</ActionButton>
              )}
              {r.actionError && <ActionButton key="d" intent="dismissError" id={r.id}>{tr("Dismiss")}</ActionButton>}
              <Link key="v" role="menuitem" className="wa-menu__item" to={`/app/cod/${r.id}`}>{tr("Activity")}</Link>
            </ActionMenu>
          </div>
        );
      },
    },
  ];

  return (
    <Page
      size="large"
      title={tr("COD confirmation")}
      subtitle={tr("Confirm Cash on Delivery orders before you ship. Customers tap the link in the message to confirm or cancel.")}

      tabs={<Tabs tabs={tabs} label={tr("COD orders")} main={COD_MAIN_TABS} />}
    >
      {pro ? null : teaser?.high > 0 ? (
        <Banner tone="warning">
          {tr.plural("{count} COD order in the last 30 days looked risky.", "{count} COD orders in the last 30 days looked risky.", teaser.high)}{" "}
          <Link to="/app/settings/plan">{tr("See which ones with Pro")}</Link>
        </Banner>
      ) : null}

      {runBar}

      <Card className="wa-card--list">
        <ListView
          rows={list}
          columns={columns}
          caption={tr("COD orders")}
          selectedKey={selected}
          onRowClick={(r) => setSelected(r.id)}
          searchText={(r) => `${r.orderName} ${r.customerName} ${r.phoneDisplay || ""} ${r.pincode || ""}`}
          searchPlaceholder={tr("Search orders, customers, phone numbers or PIN codes")}
          toolbar={
            <>
              <label className="wa-picker">
                <span className="wa-muted">{tr("Sort")}</span>
                <select className="wa-input wa-input--inline" value={sort} onChange={(e) => navigate(link({ sort: e.target.value }), { preventScrollReset: true, replace: true })} aria-label={tr("Sort")}>
                  {Object.entries(COD_SORTS).filter(([k]) => k !== "risk" || pro).map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}
                </select>
              </label>
              {pro && (
                <div className="wa-row-gap wa-risk-filter" role="group" aria-label={tr("Risk")}>
                  <Link className={!risk ? "wa-chip is-active" : "wa-chip"} to={link({ risk: null })}>{tr("All")}</Link>
                  {["high", "medium", "low"].map((l) => (
                    <Link key={l} className={risk === l ? "wa-chip is-active" : "wa-chip"} to={link({ risk: l })}>{tr(RISK_LABELS[l])}</Link>
                  ))}
                </div>
              )}
              {canSend && <SendWith templates={forLang} chosen={chosen} lang={lang} langs={langs} />}
            </>
          }
          empty={
            <EmptyState title={filter === "todo" || reminding ? tr("All caught up") : tr("Nothing here yet")}>
              {filter === "todo" ? tr("New COD orders appear here automatically.") : reminding ? tr("Orders waiting longer than the reminder time appear here.") : null}
            </EmptyState>
          }
        />
      </Card>
      {runMode && list.length > 0 && <p className="wa-muted wa-small wa-shortcuts">{tr("Shortcuts: S send next · J / K move between orders · C mark the selected order confirmed")}</p>}

      <Card title={tr("COD rules")} className="wa-rules" id="rules">
        <ul className="wa-status" data-rules>
          <li><span className={`wa-dot wa-dot--${rules.hold ? "on" : "off"}`} aria-hidden="true" /><span>{rules.hold ? tr("New COD orders are held until confirmed") : tr("New COD orders aren't held")}</span></li>
          <li><span className="wa-dot wa-dot--on" aria-hidden="true" /><span>{tr("Remind after {remind} h · expire after {expire} h", { remind: rules.remindHours, expire: rules.expireHours })}</span></li>
          <li><span className={`wa-dot wa-dot--${rules.autoExpire ? "on" : "unknown"}`} aria-hidden="true" /><span>{rules.autoExpire ? (rules.cancelOnExpire ? tr("Expired orders are cancelled in Shopify automatically") : tr("Unanswered orders expire automatically")) : pro ? tr("You expire unanswered orders yourself") : tr("Automatic expiry is on Pro")}</span></li>
        </ul>
        <p className="wa-muted wa-small">
          {tr("Confirmed, cancelled and unanswered orders get tags, so you can filter them in Shopify Orders.")}{" "}
          <a href={`https://${shop}/admin/orders?query=${encodeURIComponent(`tag:${rules.confirmedTag}`)}`} target="_top">{tr("See confirmed orders in Shopify")}</a>{" · "}
          <Link to="/app/settings?tab=cod">{tr("Edit COD rules")}</Link>
        </p>
      </Card>
    </Page>
  );
}
