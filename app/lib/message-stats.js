/**
 * Message analytics, computed from plain rows (pure + unit-tested).
 * logs:      MessageLog rows   { kind, templateId, templateName, day, sentAt }
 * orders:    Order rows        { isCod, codStatus, codSentAt, codRespondedAt, codRespondedBy, codTemplateId }
 * checkouts: Checkout rows     { status, sentAt, recovered, totalPrice, currency, templateId }
 */

export const KINDS = { cod_confirm: "COD confirmation", abandoned_cart: "Abandoned checkout", shipped: "Shipped", delivered: "Delivered" };

const DAY = 86400000;
export function dayRange(days, now = new Date()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(new Date(now.getTime() - i * DAY).toISOString().slice(0, 10));
  return out;
}

export function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const rate = (a, b) => (b ? a / b : null);

export function computeMessageStats({ logs = [], orders = [], checkouts = [], templates = [], days = 30, now = new Date() }) {
  const range = dayRange(days, now);
  const since = range[0];
  const inRange = (d) => d && new Date(d).toISOString().slice(0, 10) >= since;

  // messages per day, by stage
  const daily = Object.fromEntries(range.map((d) => [d, { cod_confirm: 0, abandoned_cart: 0, shipped: 0, delivered: 0 }]));
  const byKind = { cod_confirm: 0, abandoned_cart: 0, shipped: 0, delivered: 0 };
  for (const l of logs) {
    if (!(l.kind in byKind) || l.day < since) continue;
    byKind[l.kind] += 1;
    if (daily[l.day]) daily[l.day][l.kind] += 1;
  }

  // COD outcomes for orders messaged in the range
  const codSent = orders.filter((o) => o.isCod && inRange(o.codSentAt));
  const confirmed = codSent.filter((o) => o.codStatus === "confirmed").length;
  const cancelled = codSent.filter((o) => o.codStatus === "cancelled").length;
  const noReply = codSent.filter((o) => o.codStatus === "no_reply").length;
  const waiting = codSent.filter((o) => o.codStatus === "sent").length;
  const replyMinutes = codSent
    .filter((o) => o.codRespondedBy === "customer" && o.codRespondedAt && o.codSentAt)
    .map((o) => (new Date(o.codRespondedAt) - new Date(o.codSentAt)) / 60000)
    .filter((m) => m >= 0);

  // abandoned checkout recovery
  const cartSent = checkouts.filter((c) => c.sentAt && inRange(c.sentAt));
  const recovered = cartSent.filter((c) => c.recovered);
  const recoveredRevenue = recovered.reduce((s, c) => s + (Number(c.totalPrice) || 0), 0);

  // template performance
  const tplNames = Object.fromEntries(templates.map((t) => [t.id, t.name]));
  const perTpl = new Map();
  const key = (kind, id) => `${kind}:${id ?? "none"}`;
  for (const l of logs) {
    if (l.day < since) continue;
    const k = key(l.kind, l.templateId);
    if (!perTpl.has(k)) perTpl.set(k, { kind: l.kind, templateId: l.templateId ?? null, name: tplNames[l.templateId] || l.templateName || "Standard", sends: 0, good: 0, base: 0 });
    perTpl.get(k).sends += 1;
  }
  for (const o of codSent) {
    const row = perTpl.get(key("cod_confirm", o.codTemplateId));
    if (!row) continue;
    if (o.codStatus === "confirmed" || o.codStatus === "cancelled" || o.codStatus === "no_reply" || o.codStatus === "sent") row.base += 1;
    if (o.codStatus === "confirmed") row.good += 1;
  }
  for (const c of cartSent) {
    const row = perTpl.get(key("abandoned_cart", c.templateId));
    if (!row) continue;
    row.base += 1;
    if (c.recovered) row.good += 1;
  }
  const templateRows = [...perTpl.values()]
    .map((r) => ({
      ...r,
      outcomeLabel: r.kind === "cod_confirm" ? "confirmed" : r.kind === "abandoned_cart" ? "recovered" : null,
      outcomeRate: r.kind === "cod_confirm" || r.kind === "abandoned_cart" ? rate(r.good, r.base) : null,
    }))
    .sort((a, b) => b.sends - a.sends);

  const totalSent = Object.values(byKind).reduce((a, b) => a + b, 0);
  return {
    days,
    totalSent,
    byKind,
    daily: range.map((d) => ({ day: d, ...daily[d], total: Object.values(daily[d]).reduce((a, b) => a + b, 0) })),
    cod: {
      sent: codSent.length, confirmed, cancelled, noReply, waiting,
      confirmRate: rate(confirmed, codSent.length),
      cancelRate: rate(cancelled, codSent.length),
      responseRate: rate(confirmed + cancelled, codSent.length),
      medianReplyMin: median(replyMinutes),
    },
    carts: {
      sent: cartSent.length,
      recovered: recovered.length,
      recoveryRate: rate(recovered.length, cartSent.length),
      revenue: recoveredRevenue,
      currency: recovered[0]?.currency || cartSent[0]?.currency || "INR",
    },
    templates: templateRows,
  };
}

/** "8 min", "2.5 h", "1.2 days" */
export function formatDuration(minutes) {
  if (minutes == null) return "–";
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  if (minutes < 60 * 24) return `${(minutes / 60).toFixed(1).replace(/\.0$/, "")} h`;
  return `${(minutes / 1440).toFixed(1).replace(/\.0$/, "")} days`;
}
