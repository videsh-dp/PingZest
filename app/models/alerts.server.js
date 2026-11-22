/**
 * Counts and lists for the stuck-work alerts (app/lib/alerts.js). Uses the same rules as the queues.
 */
import prisma from "../db.server";
import { buildAlerts, alertTotal, STALLED_DAYS, UNSENT_HOURS } from "../lib/alerts.js";
import { expiryWhere, reminderWhere, parseActionError } from "../lib/cod-loop.js";
import { hasFeature, planOf } from "../lib/plans.js";

const DAY = 86400000;
const unset = (field) => ({ OR: [{ [field]: null }, { [field]: { isSet: false } }] });

function stalledWhere(now) {
  return {
    shippedAt: { lte: new Date(now - STALLED_DAYS * DAY), gte: new Date(now - 60 * DAY) },
    AND: [unset("deliveredAt"), unset("rtoAt")],
  };
}

export async function alertCounts(shop, settings, now = Date.now()) {
  const at = new Date(now);
  const remind = reminderWhere(settings, at);
  // "Waiting long" counts every unanswered order past the reminder time, reminded or not.
  const waitingLong = { ...remind, AND: remind.AND.slice(0, 1) };
  const [failed, notSent, noPhone, expiryDue, waiting, stalled] = await Promise.all([
    prisma.order.count({ where: { shop, actionError: { not: null } } }),
    prisma.order.count({ where: { shop, isCod: true, codStatus: "pending", phone: { not: null }, createdAt: { lte: new Date(now - UNSENT_HOURS * 3600000), gte: new Date(now - 30 * DAY) } } }),
    prisma.order.count({ where: { shop, isCod: true, codStatus: { in: ["pending", "sent"] }, createdAt: { gte: new Date(now - 30 * DAY) }, AND: [unset("phone")] } }),
    prisma.order.count({ where: { shop, ...expiryWhere(settings, at) } }),
    prisma.order.count({ where: { shop, ...waitingLong } }),
    prisma.order.count({ where: { shop, ...stalledWhere(now) } }),
  ]);
  return { failed, notSent, noPhone, expiryDue, waitingLong: waiting, stalled };
}

/** Alerts for Home and the sidebar badge. */
export async function shopAlerts(shop, settings) {
  const counts = await alertCounts(shop, settings);
  const autoExpire = Boolean(settings.codAutoExpire) && hasFeature(planOf(settings), "codAutomation");
  const alerts = buildAlerts(counts, settings, { autoExpire });
  return { alerts, total: alertTotal(alerts) };
}

/** The failed Shopify actions and stalled shipments themselves (Home lists up to 5 of each). */
export async function alertDetails(shop, now = Date.now()) {
  const [failed, stalled] = await Promise.all([
    prisma.order.findMany({ where: { shop, actionError: { not: null } }, orderBy: { actionErrorAt: "desc" }, take: 5, select: { id: true, orderName: true, actionError: true, actionErrorAt: true } }),
    prisma.order.findMany({ where: { shop, ...stalledWhere(now) }, orderBy: { shippedAt: "asc" }, take: 5, select: { id: true, orderName: true, shippedAt: true, trackingUrl: true } }),
  ]);
  return {
    failed: failed.map((o) => ({ id: o.id, orderName: o.orderName, at: o.actionErrorAt, ...parseActionError(o.actionError) })),
    stalled,
  };
}
