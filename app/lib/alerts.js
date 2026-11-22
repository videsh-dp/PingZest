/**
 * Alerts for stuck work (docs/TICKETS.md PZ-07): things that silently cost money if nobody looks.
 * Shown on Home and as a badge on Home in the sidebar. Nothing is sent outside the app.
 * Pure (unit-tested): the counts come from app/models/alerts.server.js.
 */
import { N_ } from "../i18n/core.js";
import { loopTimers } from "./cod-loop.js";

export const STALLED_DAYS = 7;
export const UNSENT_HOURS = 12;

/**
 * counts: { failed, notSent, noPhone, expiryDue, waitingLong, stalled }
 * Returns [{ id, tone, count, text: [one, other], vars, to }] most urgent first, empty ones left out.
 */
export function buildAlerts(counts = {}, settings = {}, { autoExpire = false } = {}) {
  const { remindHours, expireHours } = loopTimers(settings);
  const list = [
    {
      id: "failed", tone: "critical", count: counts.failed,
      text: [N_("{count} Shopify action failed (tag, hold or cancel)."), N_("{count} Shopify actions failed (tag, hold or cancel).")],
      to: "#failed",
    },
    {
      id: "notSent", tone: "attention", count: counts.notSent,
      text: [N_("{count} COD order has waited more than {hours} hours for its confirmation message."), N_("{count} COD orders have waited more than {hours} hours for their confirmation message.")],
      vars: { hours: UNSENT_HOURS }, to: "/app/cod",
    },
    // Past the expiry time: with the autopilot on these are handled automatically.
    autoExpire ? null : {
      id: "expiryDue", tone: "attention", count: counts.expiryDue,
      text: [N_("{count} COD order got no reply in {hours} hours: expire it or call the customer."), N_("{count} COD orders got no reply in {hours} hours: expire them or call the customers.")],
      vars: { hours: expireHours }, to: "/app/cod?filter=waiting",
    },
    {
      id: "waitingLong", tone: "attention", count: Math.max(0, (counts.waitingLong || 0) - (autoExpire ? 0 : counts.expiryDue || 0)),
      text: [N_("{count} COD order is waiting for a reply for more than {hours} hours."), N_("{count} COD orders are waiting for a reply for more than {hours} hours.")],
      vars: { hours: remindHours }, to: "/app/cod?filter=remind",
    },
    {
      id: "noPhone", tone: "attention", count: counts.noPhone,
      text: [N_("{count} COD order has no valid WhatsApp number."), N_("{count} COD orders have no valid WhatsApp number.")],
      to: "/app/cod",
    },
    {
      id: "stalled", tone: "info", count: counts.stalled,
      text: [N_("{count} shipment is in transit for more than {days} days without delivery."), N_("{count} shipments are in transit for more than {days} days without delivery.")],
      vars: { days: STALLED_DAYS }, to: "#stalled",
    },
  ];
  return list.filter((a) => a && a.count > 0);
}

/** The number on the Home badge: every stuck item once. */
export function alertTotal(alerts) {
  return alerts.reduce((s, a) => s + a.count, 0);
}
