import { Link, useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { widgetAnalytics } from "../models/widgets.server";
import { messageAnalytics } from "../models/orders.server";
import { prepaidStats } from "../models/prepaid.server";
import { riskTeaser } from "../models/risk.server";
import { returnsAnalytics } from "../models/rto.server";
import { getSettings } from "../models/settings.server";
import { hasFeature, planOf } from "../lib/plans.js";
import { HOUR_BANDS, MIN_PIN_ORDERS, breakdownCsv } from "../lib/rto.js";
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
  const settings = await getSettings(session.shop);
  const pro = hasFeature(planOf(settings), "rtoInsights");
  const [widgets, messages, prepaid, risk, returns] = await Promise.all([
    widgetAnalytics(session.shop, days), messageAnalytics(session.shop, days), prepaidStats(session.shop, days), riskTeaser(session.shop, days),
    // Breakdowns only leave the server on Pro.
    returnsAnalytics(session.shop, settings, days, { withBreakdowns: pro }),
  ]);
  return { ...widgets, messages: { ...messages, prepaid, risk }, returns, pro };
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

      <div className="wa-grid wa-grid--2">
        <Stat label={tr("Switched to prepaid")} value={tr.n(m.prepaid.converted)}
          hint={m.prepaid.converted
            ? tr("{amount} no longer at risk of a COD return · {discount} given as discount", { amount: tr.money(m.prepaid.value, m.prepaid.currency), discount: tr.money(m.prepaid.discounts, m.prepaid.currency) })
            : tr("{count} customers opened the payment link", { count: tr.n(m.prepaid.offered) })} />
        <Stat label={tr("Risky COD orders")} value={tr.n(m.risk.high)} hint={tr("{count} medium risk", { count: tr.n(m.risk.medium) })} />
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

const SEGMENTS = {
  first: N_("First order"), repeat: N_("Repeat customer"), unknown: N_("Unknown"),
  coupon: N_("Used a coupon"), none: N_("No coupon"),
  confirmed: N_("Confirmed before shipping"), unconfirmed: N_("Shipped without confirmation"),
  ...Object.fromEntries(HOUR_BANDS.map((b) => [b.id, b.label])),
};

function BreakdownTable({ rows, label, first }) {
  const tr = useT();
  const pct = (r) => (r == null ? "–" : tr.pct(r));
  return (
    <table className="wa-table">
      <thead>
        <tr>
          <th>{first}</th>
          <th className="wa-right">{tr("COD orders")}</th>
          <th className="wa-right">{tr("Cancelled")}</th>
          <th className="wa-right">{tr("No reply")}</th>
          <th className="wa-right">{tr("Returned (RTO)")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{label(r)}</td>
            <td className="wa-right">{tr.n(r.orders)}</td>
            <td className="wa-right">{pct(r.cancelRate)}</td>
            <td className="wa-right">{pct(r.noReplyRate)}</td>
            <td className="wa-right">
              {r.rtoRate == null ? "–" : <><span className="wa-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, r.rtoRate * 100)}%` }} /></span>{pct(r.rtoRate)}</>}
              {r.shipped ? <span className="wa-muted wa-small"> · {tr("{count} shipped", { count: tr.n(r.shipped) })}</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReturnsView({ r, pro }) {
  const tr = useT();
  const seg = (row) => tr(SEGMENTS[row.key] || row.key);
  const b = r.breakdowns;
  const download = () => {
    const sections = [
      { title: tr("Confirmed vs not confirmed"), rows: b.confirmation.map((x) => ({ ...x, label: seg(x) })) },
      { title: tr("PIN code"), rows: b.pincodes },
      { title: tr("First order vs repeat"), rows: b.firstTime.map((x) => ({ ...x, label: seg(x) })) },
      { title: tr("Coupon"), rows: b.coupon.map((x) => ({ ...x, label: seg(x) })) },
      { title: tr("Order time"), rows: b.hours.map((x) => ({ ...x, label: seg(x) })) },
    ];
    const blob = new Blob([breakdownCsv(sections)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pingzest-returns-${r.days}d.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  return (
    <>
      <div className="wa-grid wa-grid--4">
        <Stat
          label={tr("Saved on returns")}
          value={r.saved == null ? "–" : tr.money(r.saved, r.currency)}
          hint={r.cost == null ? tr("Set your average return cost in Settings → Orders") : tr("{count} parcels × {cost}", { count: tr.n(r.avoided), cost: tr.money(r.cost, r.currency) })}
        />
        <Stat label={tr("Parcels you didn't ship")} value={tr.n(r.avoided)} hint={tr("{cancelled} cancelled or unanswered · {prepaid} paid online", { cancelled: tr.n(r.cancelled), prepaid: tr.n(r.prepaid) })} />
        <Stat label={tr("COD orders")} value={tr.n(r.total)} hint={tr("last {days} days", { days: r.days })} />
        <Stat label={tr("Returned (RTO)")} value={r.rto.rate == null ? "–" : tr.pct(r.rto.rate)} hint={tr("{returned} of {shipped} shipped COD orders", { returned: tr.n(r.rto.returned), shipped: tr.n(r.rto.shipped) })} />
      </div>
      <p className="wa-muted wa-small">
        {tr("Saved on returns = COD orders cancelled or left unanswered that you didn't ship, plus orders paid online, × your average cost of a returned parcel.")}{" "}
        <Link to="/app/settings?tab=orders">{r.costIsDefault ? tr("Set your own cost") : tr("Change the cost")}</Link>{" · "}
        {tr("Mark returned parcels in COD confirmation (Returned (RTO)) to see where returns come from.")}
      </p>

      {!pro ? (
        <Card title={tr("Where returns come from")}>
          <EmptyState title={tr("Returns insights are on Pro")} action={<Link className="wa-button wa-button--primary" to="/app/settings/plan">{tr("See Pro")}</Link>}>
            {tr("See cancel, no-reply and return rates by PIN code, first-time vs repeat buyers, coupon use and order time, and whether confirmed orders come back less often. Export to CSV.")}
          </EmptyState>
        </Card>
      ) : r.total === 0 ? (
        <Card><EmptyState title={tr("No COD orders in this period")}>{tr("Breakdowns appear as COD orders come in.")}</EmptyState></Card>
      ) : (
        <>
          <div className="wa-row-between">
            <h2 className="wa-h3">{tr("Where returns come from")}</h2>
            <button type="button" className="wa-button wa-button--secondary" onClick={download}>{tr("Export CSV")}</button>
          </div>
          <Card title={tr("Confirmed vs not confirmed")}>
            <BreakdownTable rows={b.confirmation} label={seg} first={tr("Shipped orders")} />
            <p className="wa-muted wa-small">{tr("If confirmed orders come back much less often, confirming every COD order before shipping pays off.")}</p>
          </Card>
          <Card title={tr("By PIN code")}>
            {b.pincodes.length === 0
              ? <p className="wa-muted">{tr("No PIN code has {count} or more COD orders yet.", { count: MIN_PIN_ORDERS })}</p>
              : <BreakdownTable rows={b.pincodes} label={(x) => <span className="wa-code">{x.key}</span>} first={tr("PIN code")} />}
            <p className="wa-muted wa-small">{tr("Worst first, from {count} orders. Small numbers can mislead: ask for prepaid or call before blocking a PIN code.", { count: MIN_PIN_ORDERS })}</p>
          </Card>
          <div className="wa-grid wa-grid--2">
            <Card title={tr("First order vs repeat")}><BreakdownTable rows={b.firstTime} label={seg} first={tr("Customer")} /></Card>
            <Card title={tr("Coupon")}><BreakdownTable rows={b.coupon} label={seg} first={tr("Coupon")} /></Card>
          </div>
          <Card title={tr("Order time")}><BreakdownTable rows={b.hours} label={seg} first={tr("Placed")} /></Card>
        </>
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
  // Opens on Returns: what COD confirmation saved, the number that matters most.
  const view = ["widgets", "messages"].includes(params.get("view")) ? params.get("view") : "returns";
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
      size="large"
      title={tr("Analytics")}
      subtitle={tr("What COD confirmation saved you, the messages you send, and how shoppers use your widgets. Widget numbers are daily totals only: no cookies or personal data.")}
      tabs={
        <div className="wa-row-between wa-tabs-row">
          <Tabs param="view" label={tr("Analytics")} tabs={[{ id: "returns", label: tr("Returns") }, { id: "messages", label: tr("Messages") }, { id: "widgets", label: tr("Widgets") }]} />
          <Tabs param="days" variant="segmented" label={tr("Date range")} tabs={[{ id: "30", label: tr("{days} days", { days: 30 }) }, { id: "7", label: tr("{days} days", { days: 7 }) }, { id: "90", label: tr("{days} days", { days: 90 }) }]} />
        </div>
      }
    >

      {view === "messages" ? <MessagesView m={a.messages} /> : view === "returns" ? <ReturnsView r={a.returns} pro={a.pro} /> : empty ? (
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
