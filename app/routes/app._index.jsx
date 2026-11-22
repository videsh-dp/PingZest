/**
 * Home: is PingZest set up and working, and what needs doing today?
 *   1. Setup guide (5 COD-first steps that tick themselves; collapsible, dismissible) until it's done.
 *   2. One "Needs attention" banner for stuck work, with the failed actions and stalled parcels below it.
 *   3. Status: COD protection, follow-up timers, storefront widgets, plan.
 *   4. Today: the work waiting in each queue (what the old sidebar badges showed).
 *   5. Saved on returns (₹) and the COD results, then widget clicks.
 */
import { useEffect } from "react";
import { useFetcher, useLoaderData, useRouteLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { dashboardStats, navCounts } from "../models/orders.server";
import { fetchShopName } from "../models/shopify-admin.server";
import { savedSummary } from "../models/rto.server";
import { shopAlerts, alertDetails } from "../models/alerts.server";
import { appUrl } from "../models/messages.server";
import { ACTION_LABELS, loopTimers } from "../lib/cod-loop.js";
import { cleanRtoCost, DEFAULT_RTO_COST } from "../lib/rto.js";
import { DEFAULT_TEMPLATES, renderTemplate } from "../lib/templates.js";
import { waLink } from "../lib/whatsapp.js";
import { formatCurrency } from "../i18n/core.js";
import { hasFeature, planOf } from "../lib/plans.js";
import { embedOn, embedActivation } from "../lib/embed.js";
import prisma from "../db.server";
import { Page, Card, Stat, Banner, ActionButton, SetupGuide, WhatsAppIcon } from "../components/ui";
import { useT } from "../i18n/react.jsx";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  let settings = await getSettings(shop);

  // First visit: remember the store name for messages.
  if (!settings.storeName) {
    try {
      const name = await fetchShopName(admin);
      if (name) settings = await prisma.shopSettings.update({ where: { shop }, data: { storeName: name } });
    } catch { /* not critical */ }
  }

  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const embedLink = `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${apiKey}/app-embed`;

  const [stats, counts, saved, { alerts }, details, codSent] = await Promise.all([
    dashboardStats(shop),
    navCounts(shop, { delayMin: settings.abandonDelayMin, settings }),
    savedSummary(shop, settings, 30),
    shopAlerts(shop, settings),
    alertDetails(shop),
    prisma.order.count({ where: { shop, isCod: true, OR: [{ codSentAt: { not: null } }, { codRespondedBy: "customer" }] } }),
  ]);

  // "Send a test to yourself": the standard COD message for a sample order, to the store's own number.
  const lang = settings.defaultLang || "en";
  const sample = renderTemplate(DEFAULT_TEMPLATES.cod_confirm[lang] || DEFAULT_TEMPLATES.cod_confirm.en, {
    name: "Priya", order_no: "#1001", amount: formatCurrency(1299, saved.currency || "INR", lang), items: "1 × Sample product",
    store_name: settings.storeName || shop.replace(".myshopify.com", ""),
    confirm_link: `${appUrl()}/c/sample?shop=${encodeURIComponent(shop)}${lang !== "en" ? `&l=${lang}` : ""}`,
    order_status_link: `https://${shop}`,
  }, { lang });
  const pro = hasFeature(planOf(settings), "codAutomation");
  const { remindHours, expireHours } = loopTimers(settings);

  return {
    storeName: settings.storeName,
    plan: planOf(settings),
    stats, counts, saved, alerts, details, embedLink,
    status: { hold: settings.codHold, remindHours, expireHours, autoExpire: pro && settings.codAutoExpire, embed: embedOn(settings), embedChecked: Boolean(settings.embedCheckedAt) },
    setup: {
      dismissed: Boolean(settings.setupDismissedAt),
      number: Boolean(settings.whatsappNumber),
      firstSend: codSent > 0 || Boolean(settings.testSentAt),
      hold: Boolean(settings.codHold),
      cost: settings.rtoCost != null,
      embed: embedOn(settings),
      embedActiveAt: settings.embedActiveAt,
      embedCheckedAt: settings.embedCheckedAt,
      testLink: settings.whatsappNumber ? waLink(settings.whatsappNumber, sample.text) : null,
      defaultCost: DEFAULT_RTO_COST[saved.currency] ?? null,
      currency: saved.currency,
      hasCodOrders: stats.codTodo + stats.codWaiting > 0,
    },
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = Object.fromEntries(await request.formData());
  const set = (data) => prisma.shopSettings.update({ where: { shop }, data }).then(() => ({ ok: true }));
  switch (form.intent) {
    case "dismissSetup": return set({ setupDismissedAt: new Date() });
    case "showSetup": return set({ setupDismissedAt: null });
    case "testSent": return set({ testSentAt: new Date() });
    case "holdOn": return set({ codHold: true });
    case "rtoCost": {
      const cost = cleanRtoCost(form.rtoCost);
      if (cost == null) return { error: "rtoCost" };
      return set({ rtoCost: cost });
    }
    // Theme app embed status read in the browser with App Bridge (shopify.app.extensions()).
    case "embedStatus": {
      const now = new Date();
      return set(form.active === "1" ? { embedActiveAt: now, embedCheckedAt: now } : { embedActiveAt: null, embedCheckedAt: now });
    }
    case "embedManual": return set({ embedManual: form.on === "1" });
    default: return { ok: false };
  }
};

/** Reads whether the PingZest app embed is on in the live theme and tells the server (at most every 10 minutes). */
function useEmbedStatus(setup) {
  const fetcher = useFetcher({ key: "embed-status" });
  useEffect(() => {
    const app = typeof window !== "undefined" ? window.shopify?.app : null;
    if (!app?.extensions) return;
    const last = setup.embedCheckedAt ? new Date(setup.embedCheckedAt).getTime() : 0;
    if (Date.now() - last < 10 * 60e3) return;
    let cancelled = false;
    Promise.resolve(app.extensions()).then((list) => {
      if (cancelled || !Array.isArray(list)) return;
      const embed = embedActivation(list);
      fetcher.submit({ intent: "embedStatus", active: embed?.status === "active" ? "1" : "0" }, { method: "post" });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return typeof window !== "undefined" && Boolean(window.shopify?.app?.extensions);
}

function Guide({ setup, embedLink }) {
  const tr = useT();
  const fetcher = useFetcher();
  const canRead = useEmbedStatus(setup);
  const post = (data) => fetcher.submit(data, { method: "post" });
  const pending = fetcher.formData?.get("intent");
  const steps = [
    {
      id: "number", done: setup.number,
      title: tr("Add your WhatsApp number"),
      text: tr("Messages open in WhatsApp on this number, and customers can chat with you from the confirm page."),
      action: <Link className="wa-button wa-button--primary" to="/app/settings">{tr("Add number")}</Link>,
    },
    {
      id: "firstSend", done: setup.firstSend || pending === "testSent",
      title: tr("Send your first COD confirmation"),
      text: setup.hasCodOrders
        ? tr("Open the queue and send one in a click. The customer taps Confirm or Cancel and the order is tagged in Shopify.")
        : tr("No COD orders yet? Send the message to yourself to see what customers get, and tap the link."),
      action: (
        <span className="wa-row-gap">
          {setup.hasCodOrders && <Link className="wa-button wa-button--primary" to="/app/cod">{tr("Open COD queue")}</Link>}
          {setup.testLink ? (
            <a className="wa-button wa-button--whatsapp" href={setup.testLink} target="_blank" rel="noopener noreferrer" onClick={() => post({ intent: "testSent" })}>
              <WhatsAppIcon /> {tr("Send a test to yourself")}
            </a>
          ) : <span className="wa-muted wa-small">{tr("Add your number first to send a test.")}</span>}
        </span>
      ),
    },
    {
      id: "hold", done: setup.hold || pending === "holdOn",
      title: tr("Hold fulfillment until the customer confirms"),
      text: tr("Shopify shows new COD orders as On hold, so nobody packs one by mistake. PingZest releases the hold when the order is confirmed."),
      action: <button type="button" className="wa-button wa-button--primary" onClick={() => post({ intent: "holdOn" })} disabled={Boolean(pending)}>{tr("Turn on hold")}</button>,
    },
    {
      id: "cost", done: setup.cost || pending === "rtoCost",
      title: tr("Set the cost of a returned parcel"),
      text: tr("Shipping both ways, packing and lost ad spend. PingZest uses it to show what COD confirmation saves you."),
      action: (
        <fetcher.Form method="post" className="wa-row-gap">
          <input type="hidden" name="intent" value="rtoCost" />
          <label className="wa-visually-hidden" htmlFor="setup-rto">{tr("Cost of one returned parcel ({currency})", { currency: setup.currency })}</label>
          <input id="setup-rto" className="wa-input wa-input--num" name="rtoCost" type="number" min={0} step="1" defaultValue={setup.defaultCost ?? ""} required />
          <span className="wa-muted">{setup.currency}</span>
          <button type="submit" className="wa-button wa-button--primary">{tr("Save")}</button>
        </fetcher.Form>
      ),
    },
    {
      id: "embed", done: setup.embed || pending === "embedManual",
      title: tr("Turn on PingZest in your theme"),
      text: canRead
        ? tr("One switch in the theme editor shows your chat button and banner. This step ticks itself when Shopify reports it on.")
        : tr("One switch in the theme editor shows your chat button and banner."),
      action: (
        <span className="wa-row-gap">
          <a className="wa-button wa-button--primary" href={embedLink} target="_top">{tr("Open theme editor")}</a>
          {!canRead && <button type="button" className="wa-button wa-button--secondary" onClick={() => post({ intent: "embedManual", on: "1" })}>{tr("It's on")}</button>}
        </span>
      ),
    },
  ];
  if (setup.dismissed) return null;
  return (
    <SetupGuide
      title={tr("Set up COD confirmation")}
      intro={tr("Five steps to confirm COD orders on WhatsApp before you ship. No Meta setup: you send from your own WhatsApp.")}
      steps={steps}
      onDismiss={() => post({ intent: "dismissSetup" })}
    />
  );
}

export default function Index() {
  const tr = useT();
  const { storeName, plan, stats, counts, saved, alerts, details, status, setup, embedLink } = useLoaderData();
  const app = useRouteLoaderData("routes/app") || {};
  const clicks = stats.clicksByType;
  const totalClicks = Object.values(clicks).reduce((a, b) => a + b, 0);
  const responded = stats.confirmed + stats.cancelled;
  const allDone = setup.number && setup.firstSend && setup.hold && setup.cost && setup.embed;

  const today = [
    { id: "cod", count: counts.pending, to: "/app/cod", text: [tr.plural("Send {count} COD confirmation", "Send {count} COD confirmations", counts.pending)] },
    { id: "remind", count: counts.remind, to: "/app/cod?filter=remind", text: [tr.plural("Remind {count} customer who hasn't replied", "Remind {count} customers who haven't replied", counts.remind)] },
    { id: "carts", count: counts.carts, to: "/app/carts", text: [tr.plural("Message {count} abandoned checkout", "Message {count} abandoned checkouts", counts.carts)] },
    { id: "updates", count: counts.updates, to: "/app/updates", text: [tr.plural("Send {count} shipping or delivery update", "Send {count} shipping or delivery updates", counts.updates)] },
  ];
  const todo = today.filter((t) => t.count > 0);

  return (
    <Page size="large" title={app.staff ? tr("Welcome, {name}", { name: app.staff.split(" ")[0] }) : "PingZest"} subtitle={storeName || app.shop || ""}>
      {!allDone && <Guide setup={setup} embedLink={embedLink} />}

      {alerts.length > 0 && (
        <Banner tone={alerts.some((a) => a.tone === "critical") ? "critical" : "warning"}>
          <strong>{tr("Needs attention")}</strong>
          <ul className="wa-alerts" aria-label={tr("Needs attention")}>
            {alerts.map((a) => (
              <li key={a.id} data-alert={a.id}>
                {a.to.startsWith("#")
                  ? <a href={a.to}>{tr.plural(a.text[0], a.text[1], a.count, a.vars)}</a>
                  : <Link to={a.to}>{tr.plural(a.text[0], a.text[1], a.count, a.vars)}</Link>}
              </li>
            ))}
          </ul>
        </Banner>
      )}

      <div className="wa-home">
        <div className="wa-home__main">
          <Card title={tr("Today")}>
            {todo.length === 0 ? (
              <p className="wa-muted" data-today="none">{tr("All caught up. New orders appear in the queues automatically.")}</p>
            ) : (
              <ul className="wa-todo" aria-label={tr("Today")}>
                {todo.map((t) => (
                  <li key={t.id} data-today={t.id}>
                    <Link to={t.to} className="wa-todo__link">
                      <span className="wa-todo__count">{t.count > 99 ? "99+" : t.count}</span>
                      <span className="wa-todo__text">{t.text[0]}</span>
                      <span aria-hidden="true" className="wa-todo__arrow">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {details.failed.length > 0 && (
            <Card title={tr("Shopify actions that failed")}>
              <div id="failed">
                {details.failed.map((f) => (
                  <div key={f.id} className="wa-alert-row">
                    <div>
                      <Link to={`/app/cod/${f.id}`}><strong>{f.orderName}</strong></Link> · {tr(ACTION_LABELS[f.kind] || ACTION_LABELS.other)}
                      <div className="wa-muted wa-small">{f.message} · {tr.ago(f.at)}</div>
                    </div>
                    <div className="wa-actions">
                      <ActionButton action="/app/cod" intent="retry" id={f.id}>{tr("Retry")}</ActionButton>
                      <ActionButton action="/app/cod" intent="dismissError" id={f.id} tone="plain">{tr("Dismiss")}</ActionButton>
                    </div>
                  </div>
                ))}
              </div>
              <p className="wa-muted wa-small">{tr("Usually a missing permission or an order changed in Shopify. Retry, or fix it in Shopify and dismiss.")}</p>
            </Card>
          )}

          {details.stalled.length > 0 && (
            <Card title={tr("Shipments without delivery")}>
              <div id="stalled">
                {details.stalled.map((o) => (
                  <div key={o.id} className="wa-alert-row">
                    <div>
                      <strong>{o.orderName}</strong>
                      <div className="wa-muted wa-small">{tr("shipped {when}", { when: tr.ago(o.shippedAt) })}{o.trackingUrl ? " · " : ""}{o.trackingUrl && <a href={o.trackingUrl} target="_blank" rel="noopener noreferrer">{tr("Track")}</a>}</div>
                    </div>
                    <ActionButton action="/app/updates" intent="delivered" id={o.id}>{tr("Mark delivered")}</ActionButton>
                  </div>
                ))}
              </div>
              <p className="wa-muted wa-small">{tr("Check with the courier before the customer asks. If a parcel came back, mark it Returned (RTO) in COD confirmation.")}</p>
            </Card>
          )}

          <Card title={tr("Saved on returns, last 30 days")} className="wa-saved">
            <p className="wa-saved__value">{saved.saved == null ? tr.n(saved.avoided) : tr.money(saved.saved, saved.currency)}</p>
            <p className="wa-muted">{tr("{count} parcels you didn't ship", { count: tr.n(saved.avoided) })}</p>
            <div className="wa-grid wa-grid--3 wa-grid--tight">
              <Stat label={tr("Confirmed")} value={stats.confirmed} />
              <Stat label={tr("Cancelled")} value={stats.cancelled} hint={tr("returns avoided")} />
              <Stat label={tr("Response rate")} value={stats.codWaiting + responded ? tr.pct(responded / (stats.codWaiting + responded)) : "–"} />
            </div>
            <p className="wa-muted wa-small">
              {saved.cost == null
                ? tr("Each cancelled COD order is a parcel you didn't ship and pay to get back.")
                : tr("Each COD order you didn't ship after a cancel or no reply saves about {cost} in return costs.", { cost: tr.money(saved.cost, saved.currency) })}{" "}
              <Link to="/app/analytics">{tr("See returns")}</Link> · <Link to="/app/settings?tab=cod">{tr("Change the cost")}</Link>
            </p>
          </Card>
        </div>

        <div className="wa-home__side">
          <Card title={tr("Status")}>
            <ul className="wa-status" aria-label={tr("Status")}>
              <li data-status="cod">
                <span className={`wa-dot wa-dot--${status.hold ? "on" : "off"}`} aria-hidden="true" />
                <span>{status.hold ? tr("COD orders held until confirmed") : tr("COD orders aren't held")}</span>
              </li>
              <li data-status="timers">
                <span className="wa-dot wa-dot--on" aria-hidden="true" />
                <span>{tr("Remind after {remind} h · expire after {expire} h", { remind: status.remindHours, expire: status.expireHours })}{status.autoExpire ? ` · ${tr("automatic")}` : ""}</span>
              </li>
              <li data-status="widgets">
                <span className={`wa-dot wa-dot--${status.embed ? "on" : status.embedChecked ? "warn" : "unknown"}`} aria-hidden="true" />
                <span>{status.embed ? tr("Store widgets are live") : status.embedChecked ? tr("Store widgets are off") : tr("Store widgets: not checked yet")}</span>
                {!status.embed && <a href={embedLink} target="_top" className="wa-small">{tr("Turn on")}</a>}
              </li>
              <li data-status="plan">
                <span className="wa-dot wa-dot--on" aria-hidden="true" />
                <span>{plan === "pro" ? tr("Pro plan") : tr("Free plan")}</span>
                <Link to="/app/settings/plan" className="wa-small">{plan === "pro" ? tr("Manage") : tr("Compare plans")}</Link>
              </li>
            </ul>
            <p className="wa-muted wa-small"><Link to="/app/cod#rules">{tr("COD rules")}</Link> · <Link to="/app/settings">{tr("Settings")}</Link></p>
          </Card>

          <Card title={tr("Widget clicks, last 30 days")}>
            <div className="wa-grid wa-grid--2 wa-grid--tight">
              <Stat label={tr("Chat")} value={clicks.chat || 0} />
              <Stat label={tr("Product")} value={clicks.product || 0} />
              <Stat label={tr("Cart")} value={clicks.cart || 0} />
              <Stat label={tr("Discount")} value={clicks.discount || 0} />
            </div>
            {totalClicks === 0 ? <p className="wa-muted wa-small">{tr("No clicks yet.")} <Link to="/app/widgets">{tr("Design your widgets")}</Link></p> : <Link to="/app/analytics?view=widgets">{tr("See full analytics")}</Link>}
          </Card>

          {!setup.firstSend && (
            <Card>
              <p className="wa-small">{tr("PingZest prepares every message and opens WhatsApp with it typed in. You press send from your own WhatsApp, so there's no Meta setup and no per-message fees.")}</p>
            </Card>
          )}
          {setup.dismissed && !allDone && (
            <p className="wa-small"><HomeShowGuide /></p>
          )}
        </div>
      </div>
    </Page>
  );
}

function HomeShowGuide() {
  const tr = useT();
  const fetcher = useFetcher();
  return <button type="button" className="wa-link" onClick={() => fetcher.submit({ intent: "showSetup" }, { method: "post" })}>{tr("Show the setup guide")}</button>;
}
