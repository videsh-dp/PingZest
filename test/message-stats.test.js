import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMessageStats, median, formatDuration, dayRange } from "../app/lib/message-stats.js";

const now = new Date("2026-11-20T12:00:00Z");
const t = (iso) => new Date(iso);

test("median and duration formatting", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(formatDuration(0.2), "1 min");
  assert.equal(formatDuration(42), "42 min");
  assert.equal(formatDuration(150), "2.5 h");
  assert.equal(formatDuration(120), "2 h");
  assert.equal(formatDuration(2880), "2 days");
  assert.equal(formatDuration(null), "–");
  assert.deepEqual(dayRange(3, now), ["2026-11-18", "2026-11-19", "2026-11-20"]);
});

test("message stats: per stage, COD outcomes, cart recovery, template performance", () => {
  const logs = [
    { kind: "cod_confirm", templateId: 1, templateName: "Standard", day: "2026-11-19" },
    { kind: "cod_confirm", templateId: 1, templateName: "Standard", day: "2026-11-19" },
    { kind: "cod_confirm", templateId: 2, templateName: "Short", day: "2026-11-20" },
    { kind: "abandoned_cart", templateId: 5, templateName: "Cart", day: "2026-11-20" },
    { kind: "shipped", templateId: null, templateName: "", day: "2026-11-20" },
    { kind: "shipped", templateId: null, templateName: "", day: "2026-09-01" }, // out of range
  ];
  const orders = [
    { isCod: true, codStatus: "confirmed", codSentAt: t("2026-11-19T10:00Z"), codRespondedAt: t("2026-11-19T10:10Z"), codRespondedBy: "customer", codTemplateId: 1 },
    { isCod: true, codStatus: "cancelled", codSentAt: t("2026-11-19T11:00Z"), codRespondedAt: t("2026-11-19T11:30Z"), codRespondedBy: "customer", codTemplateId: 1 },
    { isCod: true, codStatus: "confirmed", codSentAt: t("2026-11-20T09:00Z"), codRespondedAt: t("2026-11-20T09:20Z"), codRespondedBy: "merchant", codTemplateId: 2 },
    { isCod: true, codStatus: "pending", codSentAt: null },
    { isCod: false, codStatus: "pending", codSentAt: null },
  ];
  const checkouts = [
    { status: "sent", sentAt: t("2026-11-20T08:00Z"), recovered: true, totalPrice: "2598", currency: "INR", templateId: 5 },
    { status: "sent", sentAt: t("2026-11-20T08:30Z"), recovered: false, totalPrice: "999", currency: "INR", templateId: 5 },
  ];
  const s = computeMessageStats({ logs, orders, checkouts, templates: [{ id: 2, name: "Short & friendly" }], days: 7, now });

  assert.equal(s.totalSent, 5);
  assert.deepEqual(s.byKind, { cod_confirm: 3, cod_reminder: 0, abandoned_cart: 1, shipped: 1, delivered: 0 });
  assert.equal(s.daily.at(-1).total, 3);
  assert.equal(s.daily.length, 7);

  assert.equal(s.cod.sent, 3);
  assert.equal(s.cod.confirmed, 2);
  assert.equal(s.cod.cancelled, 1);
  assert.equal(s.cod.responseRate, 1);
  assert.equal(s.cod.medianReplyMin, 20); // customer replies only: 10 and 30 min
  assert.ok(Math.abs(s.cod.confirmRate - 2 / 3) < 1e-9);

  assert.equal(s.carts.sent, 2);
  assert.equal(s.carts.recovered, 1);
  assert.equal(s.carts.recoveryRate, 0.5);
  assert.equal(s.carts.revenue, 2598);

  const std = s.templates.find((r) => r.templateId === 1);
  assert.equal(std.sends, 2);
  assert.equal(std.outcomeRate, 0.5);
  const short = s.templates.find((r) => r.templateId === 2);
  assert.equal(short.name, "Short & friendly"); // current name wins over logged name
  assert.equal(short.outcomeRate, 1);
  const cart = s.templates.find((r) => r.templateId === 5);
  assert.equal(cart.outcomeLabel, "recovered");
  assert.equal(cart.outcomeRate, 0.5);
  const shipped = s.templates.find((r) => r.kind === "shipped");
  assert.equal(shipped.name, "Standard");
  assert.equal(shipped.outcomeRate, null);
});

test("empty data gives zeros, not errors", () => {
  const s = computeMessageStats({ days: 30, now });
  assert.equal(s.totalSent, 0);
  assert.equal(s.cod.confirmRate, null);
  assert.equal(s.cod.medianReplyMin, null);
  assert.equal(s.carts.recoveryRate, null);
  assert.deepEqual(s.templates, []);
});
