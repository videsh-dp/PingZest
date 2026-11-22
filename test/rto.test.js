import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rtoCostFor, cleanRtoCost, savings, isAvoided, bandOf, placedHourOf, firstOrderOf, rtoBreakdowns, breakdownCsv, paybackReturns,
} from "../app/lib/rto.js";

const day = new Date("2026-11-20T10:00:00Z");
const o = (x) => ({ codStatus: "confirmed", shippedAt: null, rtoAt: null, convertedToPrepaid: false, pincode: null, firstOrder: null, placedHour: null, discountCodes: "", ...x });

test("return cost: merchant's own value, else ₹500 for INR, else not set", () => {
  assert.equal(rtoCostFor(null, "INR"), 500);
  assert.equal(rtoCostFor(undefined, "USD"), null);
  assert.equal(rtoCostFor(650, "INR"), 650);
  assert.equal(rtoCostFor(0, "INR"), 0, "0 is a real choice");
  assert.equal(cleanRtoCost(""), null);
  assert.equal(cleanRtoCost("1,200"), 1200);
  assert.equal(cleanRtoCost("-5"), null);
  assert.equal(cleanRtoCost("abc"), null);
});

test("saved = parcels not shipped (cancelled / no reply) + paid online, × cost", () => {
  const rows = [
    o({ codStatus: "cancelled" }),
    o({ codStatus: "no_reply" }),
    o({ codStatus: "no_reply", shippedAt: day }), // shipped anyway: not saved
    o({ codStatus: "confirmed", convertedToPrepaid: true }),
    o({ codStatus: "confirmed" }),
    o({ codStatus: "sent" }),
  ];
  assert.equal(isAvoided(rows[2]), false);
  assert.deepEqual(savings(rows, 500), { avoided: 3, cancelled: 2, prepaid: 1, cost: 500, saved: 1500 });
  assert.equal(savings(rows, null).saved, null, "no amount without a cost");
});

test("order facts from the webhook: hour in the store's time, first order", () => {
  assert.equal(placedHourOf("2026-11-22T23:15:00+05:30"), 23);
  assert.equal(placedHourOf("2026-11-22T00:05:00-05:00"), 0);
  assert.equal(placedHourOf(null), null);
  assert.equal(bandOf(2), "night");
  assert.equal(bandOf(9), "morning");
  assert.equal(bandOf(14), "afternoon");
  assert.equal(bandOf(21), "evening");
  assert.equal(bandOf(null), "unknown");
  assert.equal(firstOrderOf({ customer: { orders_count: 1 } }), true);
  assert.equal(firstOrderOf({ customer: { orders_count: 4 } }), false);
  assert.equal(firstOrderOf({ customer: {} }), null);
});

test("breakdowns: PIN codes (min 3 orders, worst first), first-time, coupon, hour, confirmed vs not", () => {
  const rows = [
    ...[1, 2, 3].map(() => o({ pincode: "411001", codStatus: "cancelled", firstOrder: true, discountCodes: "WELCOME10", placedHour: 1 })),
    ...[1, 2, 3, 4].map(() => o({ pincode: "110001", codStatus: "confirmed", shippedAt: day, firstOrder: false, placedHour: 15 })),
    o({ pincode: "110001", codStatus: "confirmed", shippedAt: day, rtoAt: day, firstOrder: false, placedHour: 15 }),
    o({ pincode: "560001", codStatus: "confirmed" }), // only 1 order: hidden
    o({ codStatus: "sent", shippedAt: day, rtoAt: day, placedHour: 22 }), // shipped without confirmation, came back
  ];
  const b = rtoBreakdowns(rows);
  assert.deepEqual(b.pincodes.map((r) => r.key), ["411001", "110001"]);
  assert.equal(b.pincodes[0].cancelRate, 1);
  assert.equal(b.pincodes[1].rtoRate, 1 / 5);
  const first = Object.fromEntries(b.firstTime.map((r) => [r.key, r]));
  assert.equal(first.first.orders, 3);
  assert.equal(first.repeat.orders, 5);
  assert.equal(first.unknown.orders, 2);
  const coupon = Object.fromEntries(b.coupon.map((r) => [r.key, r]));
  assert.equal(coupon.coupon.cancelRate, 1);
  assert.equal(coupon.none.orders, 7);
  const hours = Object.fromEntries(b.hours.map((r) => [r.key, r.orders]));
  assert.deepEqual(hours, { night: 3, morning: 0, afternoon: 5, evening: 1, unknown: 1 });
  const conf = Object.fromEntries(b.confirmation.map((r) => [r.key, r]));
  assert.equal(conf.confirmed.shipped, 5);
  assert.equal(conf.confirmed.rtoRate, 1 / 5);
  assert.equal(conf.unconfirmed.rtoRate, 1, "unconfirmed orders came back");
  assert.equal(b.all.orders, rows.length);
});

test("CSV export: header, sections, escaping, no formulas", () => {
  const csv = breakdownCsv([{ title: "PIN code", rows: [{ key: "411001", orders: 3, confirmed: 0, cancelled: 3, noReply: 0, shipped: 0, rto: 0, cancelRate: 1, noReplyRate: 0, rtoRate: null }] }, { title: "Coupon, used", rows: [{ key: "x", label: "=HYPERLINK()", orders: 1, confirmed: 1, cancelled: 0, noReply: 0, shipped: 1, rto: 0, cancelRate: 0, noReplyRate: 0, rtoRate: 0 }] }]);
  const lines = csv.trim().split("\n");
  assert.match(lines[0], /^section,segment,orders/);
  assert.equal(lines[1], "PIN code,411001,3,0,3,0,0,0,100.0,0.0,");
  assert.ok(lines[2].startsWith(`"Coupon, used",'=HYPERLINK()`), lines[2]);
});

test("payback: prevented returns that cover Pro, only for known currencies", () => {
  assert.deepEqual(paybackReturns(500, "INR", 9.99), { count: 2, price: 849 });
  assert.deepEqual(paybackReturns(20, "USD", 9.99), { count: 1, price: 10 });
  assert.equal(paybackReturns(500, "EUR", 9.99), null);
  assert.equal(paybackReturns(null, "INR", 9.99), null);
});
