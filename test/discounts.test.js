import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiscountForm, describeDiscount } from "../app/lib/discounts.js";

const now = new Date("2026-11-20T10:00:00");

test("valid percentage discount", () => {
  const r = parseDiscountForm({ code: " welcome10 ", kind: "percentage", value: "10", minSubtotal: "999", endsAt: "2026-12-31", oncePerCustomer: "on" }, now);
  assert.equal(r.errors, undefined);
  assert.equal(r.data.code, "WELCOME10");
  assert.equal(r.data.value, 10);
  assert.equal(r.data.minSubtotal, 999);
  assert.equal(r.data.oncePerCustomer, true);
  assert.equal(r.data.title, "WELCOME10 (WA Assist banner)");
  assert.equal(r.data.endsAt.getFullYear(), 2026);
});

test("invalid inputs give friendly errors", () => {
  const r = parseDiscountForm({ code: "a b", kind: "percentage", value: "150", minSubtotal: "-1", endsAt: "2020-01-01" }, now);
  assert.deepEqual(Object.keys(r.errors).sort(), ["code", "endsAt", "minSubtotal", "value"]);
  assert.match(parseDiscountForm({ code: "OK1", value: "0" }, now).errors.value, /above 0/);
});

test("fixed amount allows over 100 and describes in rupees", () => {
  const r = parseDiscountForm({ code: "FLAT200", kind: "fixed", value: "200" }, now);
  assert.equal(r.data.kind, "fixed");
  assert.equal(describeDiscount(r.data), "₹200 off");
  assert.equal(describeDiscount({ kind: "percentage", value: 15 }), "15% off");
});
