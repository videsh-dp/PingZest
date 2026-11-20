import { Link, useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { widgetAnalytics } from "../models/widgets.server";
import { messageAnalytics } from "../models/orders.server";
import { KINDS, formatDuration } from "../lib/message-stats.js";
import { PAGE_TYPES } from "../lib/widget-config.js";
import { formatMoney } from "../lib/orders.js";
import { Page, Card, Stat, Tabs, EmptyState } from "../components/ui";
import { DailyChart } from "../components/DailyChart";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const d = parseInt(new URL(request.url).searchParams.get("days"), 10);
  const days = [7, 30, 90].includes(d) ? d : 30;
  const [widgets, messages] = await Promise.all([widgetAnalytics(session.shop, days), messageAnalytics(session.shop, days)]);
  return { ...widgets, messages };
};

const fmtPct = (r) => (r == null ? "–" : `${(r * 100).toFixed(1)}%`);

function MessagesView({ m }) {
  if (!m.totalSent && !m.cod.sent && !m.carts.sent) {
    return (
      <Card>
        <EmptyState title="No messages sent yet">
          Send your first message from <Link to="/app/cod">COD confirmation</Link> or <Link to="/app/carts">Abandoned checkouts</Link>. Results show up here.
        </EmptyState>
      </Card>
    );
  }
  return (
    <>
      <div className="wa-grid wa-grid--4">
        <Stat label="Messages sent" value={m.totalSent.toLocaleString("en-IN")} hint={`last ${m.days} days`} />
        <Stat label="COD confirmed" value={fmtPct(m.cod.confirmRate)} hint={`${m.cod.confirmed} of ${m.cod.sent} messaged · ${m.cod.cancelled} cancelled`} />
        <Stat label="Typical reply time" value={formatDuration(m.cod.medianReplyMin)} hint="median, customers tapping the confirm link" />
        <Stat label="Checkouts recovered" value={fmtPct(m.carts.recoveryRate)}
          hint={m.carts.recovered ? `${m.carts.recovered} orders · ${formatMoney(m.carts.revenue, m.carts.currency)}` : `${m.carts.sent} reminders sent`} />
      </div>

      <Card title="Messages per day">
        <DailyChart label="Messages" data={m.daily.map((d) => ({
          day: d.day, value: d.total,
          detail: Object.entries(KINDS).filter(([k]) => d[k]).map(([k, label]) => `${label}: ${d[k]}`).join(" · "),
        }))} />
      </Card>

      <div className="wa-grid wa-grid--2">
        <Card title="By stage">
          <table className="wa-table">
            <thead><tr><th>Stage</th><th className="wa-right">Sent</th></tr></thead>
            <tbody>{Object.entries(KINDS).map(([k, label]) => (
              <tr key={k}><td>{label}</td><td className="wa-right">{m.byKind[k].toLocaleString("en-IN")}</td></tr>
            ))}</tbody>
          </table>
        </Card>
        <Card title="COD replies">
          <ol className="wa-funnel">
            {[["Messaged", m.cod.sent], ["Confirmed", m.cod.confirmed], ["Cancelled", m.cod.cancelled], ["No reply", m.cod.noReply], ["Still waiting", m.cod.waiting]].map(([label, v]) => (
              <li key={label} className="wa-funnel__step">
                <span className="wa-funnel__bar" style={{ width: `${m.cod.sent ? Math.max(2, (v / m.cod.sent) * 100) : 0}%` }} aria-hidden="true" />
                <span className="wa-funnel__label">{label}</span>
                <span className="wa-funnel__value">{v}{label !== "Messaged" && m.cod.sent ? <span className="wa-muted"> · {fmtPct(v / m.cod.sent)}</span> : null}</span>
              </li>
            ))}
          </ol>
          <p className="wa-muted">Every cancelled COD order is a parcel you didn't ship and pay to get back.</p>
        </Card>
      </div>

      <Card title="Template performance">
        {m.templates.length === 0 ? <p className="wa-muted">No sends yet.</p> : (
          <table className="wa-table">
            <thead><tr><th>Template</th><th>Stage</th><th className="wa-right">Sent</th><th className="wa-right">Result</th></tr></thead>
            <tbody>{m.templates.map((r) => (
              <tr key={`${r.kind}:${r.templateId}`}>
                <td>{r.name}</td>
                <td className="wa-muted">{KINDS[r.kind]}</td>
                <td className="wa-right">{r.sends}</td>
                <td className="wa-right">
                  {r.outcomeRate == null ? <span className="wa-muted">–</span> : (
                    <><span className="wa-meter" aria-hidden="true"><span style={{ width: `${r.outcomeRate * 100}%` }} /></span>{fmtPct(r.outcomeRate)} {r.outcomeLabel}</>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <p className="wa-muted">Try two templates for the same stage for a week each, then keep the one with the higher result. <Link to="/app/templates">Edit templates</Link></p>
      </Card>
    </>
  );
}

const WIDGET_NAMES = {
  chat: "Chat button",
  discount: "Discount banner",
  product: "“Ask on WhatsApp”",
  cart: "“Order on WhatsApp”",
  share: "“Share on WhatsApp”",
};
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : "–");
const num = (n) => n.toLocaleString("en-IN");

export default function Analytics() {
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
      title="Analytics"
      subtitle="Messages you send and how shoppers use your widgets. Widget numbers are daily totals only: no cookies or personal data."
    >
      <div className="wa-row-between">
        <Tabs param="view" tabs={[{ id: "messages", label: "Messages" }, { id: "widgets", label: "Widgets" }]} />
        <Tabs param="days" tabs={[{ id: "30", label: "30 days" }, { id: "7", label: "7 days" }, { id: "90", label: "90 days" }]} />
      </div>

      {view === "messages" ? <MessagesView m={a.messages} /> : empty ? (
        <Card>
          <EmptyState title="No widget activity yet">
            Numbers appear here as soon as shoppers see your widgets. Check that the app embed is on and tracking is enabled in{" "}
            <Link to="/app/widgets">Widgets → General</Link>.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="wa-grid wa-grid--4">
            <Stat label="Widget views" value={num(totalViews)} hint="pages where a widget was shown" />
            <Stat label="Clicks" value={num(totalClicks)} hint="chats opened, shares, copies, applies" />
            <Stat label="Click-through rate" value={pct(totalClicks, totalViews)} />
            <Stat
              label="Orders with your codes"
              value={num(a.discountOrders.orders)}
              hint={a.discountOrders.orders ? `${formatMoney(a.discountOrders.revenue, a.discountOrders.currency)} in sales` : null}
            />
          </div>

          <Card title="Clicks per day">
            <DailyChart label="Clicks" data={a.daily.map((d) => ({ day: d.day, value: d.click, detail: d.view ? `${num(d.view)} views` : "" }))} />
          </Card>

          <Card title="By widget">
            <table className="wa-table">
              <thead><tr><th>Widget</th><th className="wa-right">Views</th><th className="wa-right">Clicks</th><th className="wa-right">Click rate</th></tr></thead>
              <tbody>
                {Object.keys(WIDGET_NAMES).map((w) => {
                  const r = t[w] || { view: 0, click: 0, copy: 0, apply: 0 };
                  const rate = r.view ? interactions(r) / r.view : 0;
                  return (
                    <tr key={w}>
                      <td>{WIDGET_NAMES[w]}</td>
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
            <Card title="Discount banner funnel">
              <ol className="wa-funnel">
                {[
                  ["Saw the banner", disc.view, null],
                  ["Copied the code", disc.copy, disc.view],
                  ["Tapped Apply", disc.apply, disc.view],
                  ["Ordered with a code", a.discountOrders.orders, disc.view],
                ].map(([label, value, of]) => (
                  <li key={label} className="wa-funnel__step">
                    <span className="wa-funnel__bar" style={{ width: `${disc.view ? Math.max(2, (value / disc.view) * 100) : 0}%` }} aria-hidden="true" />
                    <span className="wa-funnel__label">{label}</span>
                    <span className="wa-funnel__value">{num(value)}{of !== null && <span className="wa-muted"> · {pct(value, of)}</span>}</span>
                  </li>
                ))}
              </ol>
              {a.discountOrders.orders > 0 && (
                <p className="wa-muted">
                  {formatMoney(a.discountOrders.revenue, a.discountOrders.currency)} in sales, {formatMoney(a.discountOrders.discountGiven, a.discountOrders.currency)} given as discount.
                  Orders count anyone who used your app's codes, including from other channels.
                </p>
              )}
              {Object.keys(a.discountOrders.byCode).length > 1 && (
                <table className="wa-table">
                  <thead><tr><th>Code</th><th className="wa-right">Orders</th><th className="wa-right">Sales</th></tr></thead>
                  <tbody>{Object.entries(a.discountOrders.byCode).map(([code, v]) => (
                    <tr key={code}><td className="wa-code">{code}</td><td className="wa-right">{v.orders}</td><td className="wa-right">{formatMoney(v.revenue, a.discountOrders.currency)}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </Card>

            <Card title="Mobile vs desktop clicks">
              <div className="wa-split" role="img" aria-label={`Mobile ${pct(a.byDevice.mobile.click, deviceTotal)}, desktop ${pct(a.byDevice.desktop.click, deviceTotal)}`}>
                <span className="wa-split__a" style={{ flexGrow: a.byDevice.mobile.click || 0.0001 }} />
                <span className="wa-split__b" style={{ flexGrow: a.byDevice.desktop.click || 0.0001 }} />
              </div>
              <div className="wa-grid wa-grid--2 wa-grid--tight">
                <Stat label="Mobile" value={pct(a.byDevice.mobile.click, deviceTotal)} hint={`${num(a.byDevice.mobile.click)} clicks · ${pct(a.byDevice.mobile.click, a.byDevice.mobile.view)} click rate`} />
                <Stat label="Desktop" value={pct(a.byDevice.desktop.click, deviceTotal)} hint={`${num(a.byDevice.desktop.click)} clicks · ${pct(a.byDevice.desktop.click, a.byDevice.desktop.view)} click rate`} />
              </div>
            </Card>
          </div>

          <Card title="By page">
            <table className="wa-table">
              <thead><tr><th>Page</th><th className="wa-right">Views</th><th className="wa-right">Clicks</th><th className="wa-right">Click rate</th></tr></thead>
              <tbody>
                {pages.map(([p, v]) => (
                  <tr key={p}><td>{PAGE_TYPES[p] || "Other pages"}</td><td className="wa-right">{num(v.view)}</td><td className="wa-right">{num(v.click)}</td><td className="wa-right">{pct(v.click, v.view)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="wa-muted">Use this with page rules in <Link to="/app/widgets">Widgets</Link>: hide widgets where nobody clicks, and keep them where they work.</p>
          </Card>
        </>
      )}
    </Page>
  );
}
