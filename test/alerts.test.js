import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAlerts, alertTotal } from "../app/lib/alerts.js";
import { createT } from "../app/i18n/core.js";

test("alerts: only non-empty ones, failed actions first, no double counting of expired orders", () => {
  const a = buildAlerts({ failed: 1, notSent: 2, noPhone: 0, expiryDue: 3, waitingLong: 5, stalled: 4 }, { codRemindHours: 24, codExpireHours: 72 });
  assert.deepEqual(a.map((x) => x.id), ["failed", "notSent", "expiryDue", "waitingLong", "stalled"]);
  assert.equal(a.find((x) => x.id === "waitingLong").count, 2, "5 waiting, 3 of them already past expiry");
  assert.equal(a.find((x) => x.id === "expiryDue").vars.hours, 72);
  assert.equal(a[0].tone, "critical");
  assert.equal(alertTotal(a), 1 + 2 + 3 + 2 + 4);
});

test("alerts: with the Pro autopilot on, expired orders aren't an alert", () => {
  const a = buildAlerts({ expiryDue: 3, waitingLong: 5 }, {}, { autoExpire: true });
  assert.deepEqual(a.map((x) => x.id), ["waitingLong"]);
  assert.equal(a[0].count, 5);
});

test("alerts: nothing stuck, nothing shown; texts render", () => {
  assert.deepEqual(buildAlerts({}), []);
  const t = createT("en", {});
  const [x] = buildAlerts({ notSent: 1 });
  assert.equal(t.plural(x.text[0], x.text[1], x.count, x.vars), "1 COD order has waited more than 12 hours for its confirmation message.");
});
