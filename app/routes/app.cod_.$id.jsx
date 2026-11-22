/**
 * One COD order: its activity (sent, reminded, confirmed, held, cancelled…), Retry for a failed Shopify
 * action, and a link to the order in Shopify admin. /app/cod/<id>, with a breadcrumb back to the queue.
 */
import { Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import prisma from "../db.server";
import { toId } from "../lib/ids.js";
import { formatMoney } from "../lib/orders.js";
import { buildTimeline } from "../lib/timeline.js";
import { ACTION_LABELS, canCancelInShopify } from "../lib/cod-loop.js";
import { hasFeature, planOf } from "../lib/plans.js";
import { Page, Card, StatusBadge, ActionButton } from "../components/ui";
import { useT } from "../i18n/react.jsx";
import { N_ } from "../i18n/core.js";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const id = toId(params.id);
  const order = id ? await prisma.order.findFirst({ where: { id, shop, isCod: true } }) : null;
  if (!order) throw new Response("Order not found", { status: 404 });
  const [logs, settings] = await Promise.all([
    prisma.messageLog.findMany({ where: { shop, refId: order.id }, orderBy: { sentAt: "asc" }, select: { kind: true, sentAt: true, templateName: true } }),
    getSettings(shop),
  ]);
  const pro = hasFeature(planOf(settings), "codRisk");
  return {
    shop,
    order: {
      id: order.id,
      orderName: order.orderName,
      customerName: order.customerName,
      amount: formatMoney(order.totalPrice, order.currency),
      items: order.itemsSummary,
      pincode: order.pincode,
      status: order.codStatus,
      shopifyOrderId: order.shopifyOrderId,
      shopifyCancelled: Boolean(order.shopifyCancelledAt),
      canCancel: canCancelInShopify(order),
      actionError: Boolean(order.actionError),
      risk: pro && order.riskLevel ? order.riskLevel : null,
    },
    events: buildTimeline(order, logs),
  };
};

const BY = { customer: N_("by the customer"), merchant: N_("by you"), auto: N_("automatically") };

export default function CodOrder() {
  const tr = useT();
  const { shop, order: o, events } = useLoaderData();
  return (
    <Page
      title={tr("Order {order}", { order: o.orderName })}
      subtitle={[o.customerName, o.amount, o.items].filter(Boolean).join(" · ")}
      backTo={{ to: "/app/cod", label: tr("COD confirmation") }}
      actions={<a className="wa-button wa-button--secondary" href={`https://${shop}/admin/orders/${o.shopifyOrderId}`} target="_top">{tr("Open in Shopify")}</a>}
    >
      <div className="wa-home">
        <div>
          <Card title={tr("Activity")}>
            <ol className="wa-timeline" data-timeline>
              {events.map((e, i) => (
                <li key={`${e.kind}-${i}`} className={`wa-timeline__item${e.tone ? ` wa-timeline__item--${e.tone}` : ""}`} data-event={e.kind}>
                  <span className="wa-timeline__dot" aria-hidden="true" />
                  <div>
                    <div className="wa-timeline__text">{tr(e.text, e.vars)}{e.by ? ` ${tr(BY[e.by])}` : ""}</div>
                    <div className="wa-muted wa-small"><time dateTime={e.at}>{tr.date(e.at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</time></div>
                    {e.kind === "error" && o.actionError && (
                      <div className="wa-row-gap wa-timeline__fix">
                        <ActionButton action="/app/cod" intent="retry" id={o.id}>{tr("Retry")}</ActionButton>
                        <ActionButton action="/app/cod" intent="dismissError" id={o.id} tone="plain">{tr("Dismiss")}</ActionButton>
                        <span className="wa-muted wa-small">{tr(ACTION_LABELS[e.errorKind] || ACTION_LABELS.other)}</span>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div>
          <Card title={tr("Status")}>
            <p>{o.shopifyCancelled ? <span className="wa-badge wa-badge--neutral">{tr("Cancelled in Shopify")}</span> : <StatusBadge status={o.status} />}</p>
            {o.pincode && <p className="wa-muted">{tr("PIN {pincode}", { pincode: o.pincode })}</p>}
            <div className="wa-row-gap">
              {o.status !== "confirmed" && !o.shopifyCancelled && <ActionButton action="/app/cod" intent="status" id={o.id} extra={{ status: "confirmed" }}>{tr("Mark confirmed")}</ActionButton>}
              {o.canCancel && (
                <ActionButton action="/app/cod" intent="cancelShopify" id={o.id} tone="critical" confirmTitle={tr("Cancel in Shopify?")} confirmLabel={tr("Cancel order")} confirmText={tr("Cancel this order in Shopify? Items go back in stock if that's on in Settings. The customer isn't emailed.")}>
                  {tr("Cancel in Shopify")}
                </ActionButton>
              )}
            </div>
            <p className="wa-muted wa-small"><Link to="/app/cod">{tr("Back to the queue")}</Link></p>
          </Card>
        </div>
      </div>
    </Page>
  );
}
