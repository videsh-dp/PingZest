import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeShopInput, staffName } from "../app/lib/shop.js";

test("normalizeShopInput accepts the ways merchants type their store", () => {
  for (const raw of ["kurta-house", "Kurta-House", " kurta-house.myshopify.com ", "https://kurta-house.myshopify.com/admin", "https://admin.shopify.com/store/kurta-house/orders"]) {
    assert.equal(normalizeShopInput(raw), "kurta-house.myshopify.com", raw);
  }
  assert.equal(normalizeShopInput(""), "");
  assert.equal(normalizeShopInput("evil.com/../x"), "");
  assert.equal(normalizeShopInput("bad store"), "");
});

test("staffName", () => {
  assert.equal(staffName({ onlineAccessInfo: { associated_user: { first_name: "Priya", last_name: "Sharma" } } }), "Priya S.");
  assert.equal(staffName({ firstName: "Rahul" }), "Rahul");
  assert.equal(staffName(null), "");
});
