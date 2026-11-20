import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitize, cleanPath, shopFromRequest, requestKind, requestBody, exceptionProperties, parseStack, REDACTED } from "../app/lib/telemetry.js";
import { createPostHog, parseFlags } from "../app/lib/posthog-client.js";
import { isOn, FLAG_DEFAULTS } from "../app/lib/flags.js";
import { templateAllowance, planOf } from "../app/lib/plans.js";

test("sanitize removes customer data and secrets, keeps useful fields", () => {
  const out = sanitize({
    intent: "sent", id: "65f1a2b3c4d5e6f708192a3b", templateName: "Short", lang: "es",
    phone: "919876543210", customerName: "Priya", email: "p@x.com", note: "call +91 98765 43210",
    id_token: "eyJhbGciOiJIUzI1NiJ9.eyJkZXN0IjoiaHR0cHM6Ly94Lm15c2hvcGlmeS5jb20ifQ.sig",
    accessToken: "shpat_abc123", hmac: "abc", nested: { billing_address: { city: "Pune" }, total: "1299" },
    free: "+91 98765 43210",
  });
  assert.equal(out.intent, "sent");
  assert.equal(out.id, "65f1a2b3c4d5e6f708192a3b");
  assert.equal(out.templateName, "Short");
  for (const k of ["phone", "customerName", "email", "id_token", "accessToken", "hmac"]) assert.equal(out[k], REDACTED, k);
  assert.equal(out.nested.billing_address, REDACTED);
  assert.equal(out.nested.total, "1299");
  assert.equal(out.free, REDACTED); // looks like a phone number
  assert.match(sanitize("x".repeat(500)), /…\(500 chars\)$/);
});

test("paths hide confirm tokens and ids", () => {
  assert.equal(cleanPath("/c/AbC123xyz"), "/c/:token");
  assert.equal(cleanPath("/app/templates/65f1a2b3c4d5e6f708192a3b"), "/app/templates/:id");
  assert.equal(cleanPath("/app/cod"), "/app/cod");
});

test("shop and request kind are worked out from the request", () => {
  const jwt = (p) => `x.${Buffer.from(JSON.stringify(p)).toString("base64url")}.y`;
  assert.equal(shopFromRequest(new Request("https://a.app/webhooks/x", { headers: { "x-shopify-shop-domain": "s1.myshopify.com" } })), "s1.myshopify.com");
  assert.equal(shopFromRequest(new Request("https://a.app/app?shop=s2.myshopify.com")), "s2.myshopify.com");
  assert.equal(shopFromRequest(new Request("https://a.app/app/cod.data", { headers: { authorization: `Bearer ${jwt({ dest: "https://s3.myshopify.com" })}` } })), "s3.myshopify.com");
  assert.equal(shopFromRequest(new Request("https://a.app/c/abc")), null);
  assert.equal(requestKind(new Request("https://a.app/app/cod.data")), "data");
  assert.equal(requestKind(new Request("https://a.app/webhooks/orders")), "webhook");
  assert.equal(requestKind(new Request("https://a.app/proxy/track")), "storefront");
  assert.equal(requestKind(new Request("https://a.app/c/abc")), "confirm_page");
  assert.equal(requestKind(new Request("https://a.app/app/cod")), "document");
});

test("form bodies are logged cleaned, and the route can still read the original", async () => {
  const req = new Request("https://a.app/app/cod", { method: "POST", body: new URLSearchParams({ intent: "status", status: "confirmed", phone: "919876543210", config: '{"chat":{"greeting":"Hi"}}' }) });
  const body = await requestBody(req);
  assert.deepEqual(body, { intent: "status", status: "confirmed", phone: REDACTED, config: { chat: { greeting: "Hi" } } });
  assert.equal((await req.formData()).get("phone"), "919876543210");
});

test("errors become PostHog $exception properties with a stack trace", () => {
  const e = new TypeError("boom");
  const p = exceptionProperties(e, { path: "/app/cod", phone: "919876543210" });
  assert.equal(p.$exception_list[0].type, "TypeError");
  assert.equal(p.$exception_list[0].value, "boom");
  assert.ok(p.$exception_list[0].stacktrace.frames.length > 0);
  assert.equal(p.path, "/app/cod");
  assert.equal(p.phone, REDACTED);
  const frames = parseStack("Error: x\n    at fn (/srv/app/a.js:10:5)\n    at /srv/node_modules/b.js:1:2");
  assert.deepEqual(frames.map((f) => [f.function, f.lineno, f.in_app]), [["<anonymous>", 1, false], ["fn", 10, true]]);
});

test("PostHog client batches events and flushes to /batch/", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({}) }; };
  const ph = createPostHog({ apiKey: "phc_test", host: "https://eu.i.posthog.com/", fetchImpl, flushAt: 3, flushIntervalMs: 60_000 });
  ph.capture("api_request", "s1.myshopify.com", { status: 200 });
  ph.captureException(new Error("x"), "s1.myshopify.com");
  assert.equal(calls.length, 0);
  ph.capture("api_request", "s1.myshopify.com", { status: 500 });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://eu.i.posthog.com/batch/");
  assert.equal(calls[0].body.api_key, "phc_test");
  assert.deepEqual(calls[0].body.batch.map((e) => e.event), ["api_request", "$exception", "api_request"]);
  assert.equal(calls[0].body.batch[0].properties.$process_person_profile, false);
  await ph.shutdown();
});

test("PostHog client without a key sends nothing and returns flag defaults", async () => {
  let called = false;
  const ph = createPostHog({ apiKey: "", fetchImpl: async () => { called = true; }, defaults: { a: true } });
  ph.capture("x", "s");
  await ph.flush();
  assert.equal(called, false);
  assert.deepEqual(await ph.getFlags("s"), { a: true });
});

test("feature flags: PostHog values override defaults, are cached, and survive outages", async () => {
  let t = 0, n = 0, fail = false;
  const fetchImpl = async (url) => {
    n++;
    if (fail) throw new Error("down");
    assert.match(url, /\/flags\/\?v=2$/);
    return { ok: true, json: async () => ({ flags: { "google-translate": { enabled: false }, exp: { enabled: true, variant: "test" } } }) };
  };
  const ph = createPostHog({ apiKey: "k", fetchImpl, defaults: { "google-translate": true, other: true }, flagsTtlMs: 1000, now: () => t, onError: () => {} });
  assert.deepEqual(await ph.getFlags("s"), { "google-translate": false, other: true, exp: "test" });
  await ph.getFlags("s");
  assert.equal(n, 1); // cached
  t = 5000; fail = true;
  assert.equal((await ph.getFlags("s"))["google-translate"], false); // last known values kept
  assert.deepEqual(parseFlags({ featureFlags: { a: true, b: "v" } }), { a: true, b: "v" });
  assert.equal(isOn({ exp: "test" }, "exp"), true);
  assert.equal(isOn({ exp: "control" }, "exp"), false);
  assert.equal(isOn({}, "google-translate"), FLAG_DEFAULTS["google-translate"]);
  assert.equal(isOn({}, "unknown-flag"), false);
});

test("Free plan allows 5 custom templates; Pro is unlimited", () => {
  assert.deepEqual(templateAllowance("free", 3), { limit: 5, used: 3, remaining: 2, canCreate: true });
  assert.equal(templateAllowance("free", 5).canCreate, false);
  assert.equal(templateAllowance("free", 9).remaining, 0);
  assert.equal(templateAllowance("pro", 50).canCreate, true);
  assert.equal(planOf({ plan: "pro" }), "pro");
  assert.equal(planOf({ plan: "gold" }), "free");
  assert.equal(planOf(null), "free");
});
