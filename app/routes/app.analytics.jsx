import { Link, useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { widgetAnalytics } from "../models/widgets.server";
import { messageAnalytics } from "../models/orders.server";
import { KINDS } from "../lib/message-stats.js";
import { PAGE_TYPES } from "../lib/widget-config.js";
import { Page, Card, Stat, Tabs, EmptyState } from "../components/ui";
import { DailyChart } from "../components/DailyChart";
import { useT } from "../i18n/react.jsx";
import { N_ } from "../i18n/core.js";
import { useFlag } from "../components/flags.jsx";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const d = parseInt(new URL(request.url).searchParams.get("days"), 10);
  const days = [7, 30, 90].includes(d) ? d : 30;
  const [widgets, messages] = await Promise.all([widgetAnalytics(session.shop, days), messageAnalytics(session.shop, days)]);
  return { ...widgets, messages };
};

function MessagesView({ m }) {
  const tr = useT();
  const showTemplatePerformance = useFlag("template-performance");
  const fmtPct = tr.pct;
  if (!m.totalSent && !m.cod.sent && !m.carts.sent) {
    return (
      <Card>
        <EmptyState title={tr("No messages sent yet")}>
          {tr("Send your first message from COD confirmation or Abandoned checkouts. Results show up here.")}{" "}
          <Link to="/app/cod">{tr("COD confirmation")}</Link> · <Link to="/app/carts">{tr("Abandoned checkouts")}</Link>
        </EmptyState>
      </Card>
    );
  }
  return (
    <>
      <div className="wa-grid wa-grid--4">
        <Stat label={tr("Messages sent")} value={tr.n(m.totalSent)} hint={tr("last {days} days", { days: m.days })} />
        <Stat label={tr("COD confirmed")} value={fmtPct(m.cod.confirmRate)} hint={tr("{confirmed} of {sent} messaged · {cancelled} cancelled", { confirmed: tr.n(m.cod.confirmed), sent: tr.n(m.cod.sent), cancelled: tr.n(m.cod.cancelled) })} />
        <Stat label={tr("Typical reply time")} value={tr.duration(m.cod.medianReplyMin)} hint={tr("median, customers tapping the confirm link")} />
        <Stat label={tr("Checkouts recovered")} value={fmtPct(m.carts.recoveryRate)}
          hint={m.carts.recovered ? tr("{count} orders · {amount}", { count: tr.n(m.carts.recovered), amount: tr.money(m.carts.revenue, m.carts.currency) }) : tr("{count} reminders sent", { count: tr.n(m.carts.sent) })} />
      </div>

      <Card title={tr("Messages per day")}>
        <DailyChart label={tr("Messages")} data={m.daily.map((d) => ({
          day: d.day, value: d.total,
          detail: Object.entries(KINDS).filter(([k]) => d[k]).map(([k, label]) => `${tr(label)}: ${tr.n(d[k])}`).join(" · "),
        }))} />
      </Card>

      <div className="wa-grid wa-grid--2">
        <Card title={tr("By stage")}>
          <table className="wa-table">
            <thead><tr><th>{tr("Stage")}</th><th className="wa-right">{tr("Sent")}</th></tr></thead>
            <tbody>{Object.entries(KINDS).map(([k, label]) => (
              <tr key={k}><td>{tr(label)}</td><td className="wa-right">{tr.n(m.byKind[k])}</td></tr>
            ))}</tbody>
          </table>
        </Card>
        <Card title={tr("COD replies")}>
          <ol className="wa-funnel">
            {[[N_("Messaged"), m.cod.sent], [N_("Confirmed"), m.cod.confirmed], [N_("Cancelled"), m.cod.cancelled], [N_("No reply"), m.cod.noReply], [N_("Still waiting"), m.cod.waiting]].map(([label, v]) => (
              <li key={label} className="wa-funnel__step">
                <span className="wa-funnel__bar" style={{ width: `${m.cod.sent ? Math.max(2, (v / m.cod.sent) * 100) : 0}%` }} aria-hidden="true" />
                <span className="wa-funnel__label">{tr(label)}</span>
                <span className="wa-funnel__value">{tr.n(v)}{label !== "Messaged" && m.cod.sent ? <span className="wa-muted"> · {fmtPct(v / m.cod.sent)}</span> : null}</span>
              </li>
            ))}
          </ol>
          <p className="wa-muted">{tr("Every cancelled COD order is a parcel you didn't ship and pay to get back.")}</p>
        </Card>
      </div>

      {showTemplatePerformance && (
      <Card title={tr("Template performance")}>
        {m.templates.length === 0 ? <p className="wa-muted">{tr("No sends yet.")}</p> : (
          <table className="wa-table">
            <thead><tr><th>{tr("Template")}</th><th>{tr("Stage")}</th><th className="wa-right">{tr("Sent")}</th><th className="wa-right">{tr("Result")}</th></tr></thead>
            <tbody>{m.templates.map((r) => (
              <tr key={`${r.kind}:${r.templateId}`}>
                <td>{r.name}</td>
                <td className="wa-muted">{tr(KINDS[r.kind])}</td>
                <td className="wa-right">{r.sends}</td>
                <td className="wa-right">
                  {r.outcomeRate == null ? <span className="wa-muted">–</span> : (
                    <><span className="wa-meter" aria-hidden="true"><span style={{ width: `${r.outcomeRate * 100}%` }} /></span>{fmtPct(r.outcomeRate)} {tr(r.outcomeLabel)}</>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <p className="wa-muted">{tr("Try two templates for the same stage for a week each, then keep the one with the higher result.")} <Link to="/app/templates">{tr("Edit templates")}</Link></p>
      </Card>
      )}
    </>
  );
}

const WIDGET_NAMES = {
  chat: N_("Chat button"),
  discount: N_("Discount banner"),
  product: N_("“Ask on WhatsApp”"),
  cart: N_("“Order on WhatsApp”"),
  share: N_("“Share on WhatsApp”"),
};

export default function Analytics() {
  const tr = useT();
  const pct = (x, y) => (y ? tr.pct(x / y) : "–");
  const num = tr.n;
  const money = tr.money;
  const a = useLoaderData();
  const [params] = useSearchParams();
  const view = params.get("view") === "widgets" ? "widgets" : "messages";
  const t = a.totals;
  const interactions = (w) => (w ? w.click + w.copy + w.apply : 0);
  const totalViews = Object.values(t).reduce((s, w) => s + w.view, 0);
  const totalClicks = Object.values(t).reduce((s, w) => s + interactions(w), 0);
  const disc = t.discount || { view: 0, click: 0, copy: 0, apply: 0 };
  const deviceTotal = a.byDevice.desktop.click + a.byDevice.mobile.click;
  const pages = Object.entries(a.byPage).sort((x, y) => y[1].click - x[1].click);
  const empty = totalViews === 0 && totalClicks === 0;

  return (
    <Page
      title={tr("Analytics")}
      subtitle={tr("Messages you send and how shoppers use your widgets. Widget numbers are daily totals only: no cookies or personal data.")}
    >
      <div className="wa-row-between">
        <Tabs param="view" tabs={[{ id: "messages", label: tr("Messages") }, { id: "widgets", label: tr("Widgets") }]} />
        <Tabs param="days" tabs={[{ id: "30", label: tr("{days} days", { days: 30 }) }, { id: "7", label: tr("{days} days", { days: 7 }) }, { id: "90", label: tr("{days} days", { days: 90 }) }]} />
      </div>

      {view === "messages" ? <MessagesView m={a.messages} /> : empty ? (
        <Card>
          <EmptyState title={tr("No widget activity yet")}>
            {tr("Numbers appear here as soon as shoppers see your widgets. Check that the app embed is on and tracking is enabled in")}{" "}
            <Link to="/app/widgets">{tr("Widgets → General")}</Link>.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="wa-grid wa-grid--4">
            <Stat label={tr("Widget views")} value={num(totalViews)} hint={tr("pages where a widget was shown")} />
            <Stat label={tr("Clicks")} value={num(totalClicks)} hint={tr("chats opened, shares, copies, applies")} />
            <Stat label={tr("Click-through rate")} value={pct(totalClicks, totalViews)} />
            <Stat
              label={tr("Orders with your codes")}
              value={num(a.discountOrders.orders)}
              hint={a.discountOrders.orders ? tr("{amount} in sales", { amount: money(a.discountOrders.revenue, a.discountOrders.currency) }) : null}
            />
          </div>

          <Card title={tr("Clicks per day")}>
            <DailyChart label={tr("Clicks")} data={a.daily.map((d) => ({ day: d.day, value: d.click, detail: d.view ? tr("{count} views", { count: num(d.view) }) : "" }))} />
          </Card>

          <Card title={tr("By widget")}>
            <table className="wa-table">
              <thead><tr><th>{tr("Widget")}</th><th className="wa-right">{tr("Views")}</th><th className="wa-right">{tr("Clicks")}</th><th className="wa-right">{tr("Click rate")}</th></tr></thead>
              <tbody>
                {Object.keys(WIDGET_NAMES).map((w) => {
                  const r = t[w] || { view: 0, click: 0, copy: 0, apply: 0 };
                  const rate = r.view ? interactions(r) / r.view : 0;
                  return (
                    <tr key={w}>
                      <td>{tr(WIDGET_NAMES[w])}</td>
                      <td className="wa-right">{num(r.view)}</td>
                      <td className="wa-right">{num(interactions(r))}</td>
                      <td className="wa-right">
                        <span className="wa-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, rate * 400)}%` }} /></span>
                        {pct(interactions(r), r.view)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <div className="wa-grid wa-grid--2">
            <Card title={tr("Discount banner funnel")}>
              <ol className="wa-funnel">
                {[
                  [N_("Saw the banner"), disc.view, null],
                  [N_("Copied the code"), disc.copy, disc.view],
                  [N_("Tapped Apply"), disc.apply, disc.view],
                  [N_("Ordered with a code"), a.discountOrders.orders, disc.view],
                ].map(([label, value, of]) => (
                  <li key={label} className="wa-funnel__step">
                    <span className="wa-funnel__bar" style={{ width: `${disc.view ? Math.max(2, (value / disc.view) * 100) : 0}%` }} aria-hidden="true" />
                    <span className="wa-funnel__label">{tr(label)}</span>
                    <span className="wa-funnel__value">{num(value)}{of !== null && <span className="wa-muted"> · {pct(value, of)}</span>}</span>
                  </li>
                ))}
              </ol>
              {a.discountOrders.orders > 0 && (
                <p className="wa-muted">
                  {tr("{sales} in sales, {discount} given as discount.", { sales: money(a.discountOrders.revenue, a.discountOrders.currency), discount: money(a.discountOrders.discountGiven, a.discountOrders.currency) })}{" "}
                  {tr("Orders count anyone who used your app's codes, including from other channels.")}
                </p>
              )}
              {Object.keys(a.discountOrders.byCode).length > 1 && (
                <table className="wa-table">
                  <thead><tr><th>{tr("Code")}</th><th className="wa-right">{tr("Orders")}</th><th className="wa-right">{tr("Sales")}</th></tr></thead>
                  <tbody>{Object.entries(a.discountOrders.byCode).map(([code, v]) => (
                    <tr key={code}><td className="wa-code">{code}</td><td className="wa-right">{v.orders}</td><td className="wa-right">{money(v.revenue, a.discountOrders.currency)}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </Card>

            <Card title={tr("Mobile vs desktop clicks")}>
              <div className="wa-split" role="img" aria-label={`${tr("Mobile")} ${pct(a.byDevice.mobile.click, deviceTotal)}, ${tr("Desktop")} ${pct(a.byDevice.desktop.click, deviceTotal)}`}>
                <span className="wa-split__a" style={{ flexGrow: a.byDevice.mobile.click || 0.0001 }} />
                <span className="wa-split__b" style={{ flexGrow: a.byDevice.desktop.click || 0.0001 }} />
              </div>
              <div className="wa-grid wa-grid--2 wa-grid--tight">
                <Stat label={tr("Mobile")} value={pct(a.byDevice.mobile.click, deviceTotal)} hint={tr("{clicks} clicks · {rate} click rate", { clicks: num(a.byDevice.mobile.click), rate: pct(a.byDevice.mobile.click, a.byDevice.mobile.view) })} />
                <Stat label={tr("Desktop")} value={pct(a.byDevice.desktop.click, deviceTotal)} hint={tr("{clicks} clicks · {rate} click rate", { clicks: num(a.byDevice.desktop.click), rate: pct(a.byDevice.desktop.click, a.byDevice.desktop.view) })} />
              </div>
            </Card>
          </div>

          <Card title={tr("By page")}>
            <table className="wa-table">
              <thead><tr><th>{tr("Page")}</th><th className="wa-right">{tr("Views")}</th><th className="wa-right">{tr("Clicks")}</th><th className="wa-right">{tr("Click rate")}</th></tr></thead>
              <tbody>
                {pages.map(([p, v]) => (
                  <tr key={p}><td>{tr(PAGE_TYPES[p] || N_("Other pages"))}</td><td className="wa-right">{num(v.view)}</td><td className="wa-right">{num(v.click)}</td><td className="wa-right">{pct(v.click, v.view)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="wa-muted">{tr("Use this with page rules in Widgets: hide widgets where nobody clicks, and keep them where they work.")} <Link to="/app/widgets">{tr("Widgets")}</Link></p>
          </Card>
        </>
      )}
    </Page>
  );
}
