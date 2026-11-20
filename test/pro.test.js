import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreOrder, addressSignals, median, maxQuantity, REASONS } from "../app/lib/risk.js";
import { prepaidDiscount, canOfferPrepaid, cleanAddressForm } from "../app/lib/prepaid.js";
import { planFromSubscription, hasFeature, BILLING_PLANS, PRO_MONTHLY, PRO_YEARLY, FEATURE_LIST } from "../app/lib/plans.js";

const goodAddr = { address1: "Flat 402, Sunrise Apartments, MG Road", address2: "Near City Mall", zip: "411001", country_code: "IN", first_name: "Priya", last_name: "Shah" };

test("address checks keep only the PIN code and flags", () => {
  assert.deepEqual(addressSignals(goodAddr), { pincode: "411001", flags: [] });
  assert.deepEqual(addressSignals({ address1: "test test", zip: "000000", country_code: "IN", first_name: "x" }).flags.sort(),
    ["address_fake", "address_no_number", "address_short", "name_fake", "pin_invalid"]);
  assert.ok(addressSignals({ address1: "Main road near temple", zip: "560001", country_code: "IN", first_name: "Ravi" }).flags.includes("address_no_number"));
  assert.deepEqual(addressSignals(null), { pincode: null, flags: ["address_short"] });
  assert.equal(addressSignals({ address1: "12 Baker Street, London", zip: "NW1 6XE", country_code: "GB", first_name: "Sam" }).flags.includes("pin_invalid"), false);
});

test("a normal first order is low risk; history and address push it up", () => {
  const base = { totalPrice: "1299", phone: "919876543210", pincode: "411001", addressFlags: [], maxQuantity: 1 };
  assert.equal(scoreOrder(base, { shopOrders: 50, medianTotal: 1200 }).level, "low");

  const risky = scoreOrder({ ...base, addressFlags: ["address_short", "address_no_number"] },
    { phoneCancelled: 2, phoneNoReply: 1, pinOrders: 10, pinCancelled: 5, shopOrders: 50, medianTotal: 1200 });
  assert.equal(risky.level, "high");
  assert.equal(risky.score, 100);
  assert.equal(risky.reasons[0].code, "phone_cancelled");
  assert.deepEqual(risky.reasons.find((r) => r.code === "pin_cancel_rate").vars, { pin: "411001", rate: "50%" });

  const medium = scoreOrder({ ...base, totalPrice: "4000" }, { shopOrders: 50, medianTotal: 1200, phoneNoReply: 1 });
  assert.equal(medium.level, "medium");
  assert.deepEqual(medium.reasons.map((r) => r.code).sort(), ["high_value", "phone_no_reply"]);
});

test("loyal customers score lower; missing phone and bursts score higher", () => {
  const base = { totalPrice: "999", phone: "919876543210", pincode: "411001", addressFlags: ["address_no_number"], maxQuantity: 1 };
  assert.equal(scoreOrder(base, { phoneConfirmed: 3 }).score, 0);
  const s = scoreOrder({ ...base, phone: null, maxQuantity: 6 }, { phoneOrders24h: 2 });
  assert.deepEqual(s.reasons.map((r) => r.code), ["no_phone", "phone_burst", "address_no_number", "big_quantity"]);
  assert.equal(s.reasons.find((r) => r.code === "phone_burst").vars.count, 3);
  assert.equal(s.level, "high");
  for (const r of s.reasons) assert.ok(REASONS[r.code], r.code);
});

test("small stores don't get PIN or value signals from too little data", () => {
  const s = scoreOrder({ totalPrice: "50000", phone: "91x", pincode: "411001", addressFlags: [] }, { pinOrders: 3, pinCancelled: 3, shopOrders: 4, medianTotal: 500 });
  assert.equal(s.score, 0);
});

test("median and quantity helpers", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), 0);
  assert.equal(maxQuantity([{ quantity: 2 }, { quantity: 7 }]), 7);
});

test("prepaid discount: percent of items, capped", () => {
  assert.equal(prepaidDiscount(1000, 5), 50);
  assert.equal(prepaidDiscount(10000, 5, 200), 200);
  assert.equal(prepaidDiscount(999, 0), 0);
  assert.equal(prepaidDiscount(333.33, 5), 16.66);
});

test("prepaid offer only for unpaid, unshipped, open COD orders with a payment link", () => {
  const order = { isCod: true, codStatus: "sent" };
  const live = { displayFinancialStatus: "PENDING", totalOutstandingSet: { shopMoney: { amount: "1299" } }, paymentCollectionDetails: { additionalPaymentCollectionUrl: "https://x/pay" } };
  assert.equal(canOfferPrepaid(order, live), true);
  assert.equal(canOfferPrepaid({ ...order, codStatus: "cancelled" }, live), false);
  assert.equal(canOfferPrepaid({ ...order, shippedAt: new Date() }, live), false);
  assert.equal(canOfferPrepaid({ ...order, convertedToPrepaid: true }, live), false);
  assert.equal(canOfferPrepaid(order, { ...live, displayFinancialStatus: "PAID" }), false);
  assert.equal(canOfferPrepaid(order, { ...live, paymentCollectionDetails: null }), false);
  assert.equal(canOfferPrepaid(order, { ...live, cancelledAt: "2026-01-01" }), false);
  assert.equal(canOfferPrepaid({ isCod: false }, live), false);
});

test("address form is cleaned and checked", () => {
  assert.deepEqual(cleanAddressForm({ address1: " Flat 4,  MG Road ", address2: "Near mall", city: "Pune", zip: "411 001" }, "IN"),
    { address: { address1: "Flat 4, MG Road", address2: "Near mall", city: "Pune", zip: "411001" } });
  assert.equal(cleanAddressForm({ address1: "x", city: "Pune", zip: "411001" }, "IN").error, "address1");
  assert.equal(cleanAddressForm({ address1: "Flat 4 MG Road", city: "Pune", zip: "11001" }, "IN").error, "zip");
  assert.equal(cleanAddressForm({ address1: "12 Baker Street", city: "London", zip: "NW16XE" }, "GB").address.zip, "NW16XE");
});

test("plans: subscription status → plan, features", () => {
  assert.equal(planFromSubscription({ name: PRO_MONTHLY, status: "ACTIVE" }), "pro");
  assert.equal(planFromSubscription({ name: PRO_YEARLY, status: "active" }), "pro");
  for (const status of ["FROZEN", "CANCELLED", "DECLINED", "EXPIRED", "PENDING"]) assert.equal(planFromSubscription({ name: PRO_MONTHLY, status }), "free", status);
  assert.equal(planFromSubscription({ name: "Something else", status: "ACTIVE" }), "free");
  assert.equal(planFromSubscription(null), "free");
  assert.equal(hasFeature("pro", "codRisk"), true);
  assert.equal(hasFeature("free", "codRisk"), false);
  assert.equal(hasFeature("bogus", "prepaidOffer"), false);
  assert.ok(BILLING_PLANS[PRO_YEARLY].amount < BILLING_PLANS[PRO_MONTHLY].amount * 12);
  assert.ok(FEATURE_LIST.every((f) => f.label));
});
