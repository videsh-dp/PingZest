// The request-log middleware end to end: a fake PostHog endpoint receives what the app would send.
import { test } from "node:test";
import assert from "node:assert/strict";

const sent = [];
process.env.POSTHOG_API_KEY = "phc_test";
process.env.POSTHOG_STOREFRONT_SAMPLE = "0";
globalThis.fetch = async (url, init) => { sent.push(...JSON.parse(init.body).batch); return { ok: true, json: async () => ({}) }; };

const { requestLog } = await import("../app/middleware/request-log.server.js");
const posthog = (await import("../app/posthog.server.js")).default;
const { capture } = await import("../app/posthog.server.js");

test("each request is logged with status, timing, cleaned params; nested logs share the request id", async () => {
  const req = new Request("https://a.app/app/cod.data?shop=s1.myshopify.com&id_token=secret.jwt.value", {
    method: "POST", body: new URLSearchParams({ intent: "sent", id: "65f1a2b3c4d5e6f708192a3b", phone: "919876543210" }),
  });
  const res = await requestLog({ request: req }, async () => {
    capture("shopify_api_call", null, { operation: "orderTags" }); // logged while handling the request
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(res.status, 200);
  await posthog.flush();
  const log = sent.find((e) => e.event === "api_request");
  const call = sent.find((e) => e.event === "shopify_api_call");
  assert.equal(log.distinct_id, "s1.myshopify.com");
  assert.equal(log.properties.method, "POST");
  assert.equal(log.properties.kind, "data");
  assert.equal(log.properties.status, 200);
  assert.equal(log.properties.query.id_token, "[redacted]");
  assert.equal(log.properties.body.phone, "[redacted]");
  assert.equal(log.properties.body.intent, "sent");
  assert.deepEqual(log.properties.response, { ok: true });
  assert.ok(log.properties.duration_ms >= 0);
  assert.equal(call.distinct_id, "s1.myshopify.com");
  assert.equal(call.properties.request_id, log.properties.request_id);
});

test("thrown redirects pass through and are logged; storefront successes are sampled", async () => {
  sent.length = 0;
  await assert.rejects(
    requestLog({ request: new Request("https://a.app/app?shop=s1.myshopify.com") }, async () => { throw new Response(null, { status: 302, headers: { location: "/auth/login" } }); }),
    (r) => r instanceof Response && r.status === 302,
  );
  await requestLog({ request: new Request("https://a.app/proxy/track?shop=s1.myshopify.com", { method: "POST", body: "{}" }) }, async () => new Response(null, { status: 204 }));
  await requestLog({ request: new Request("https://a.app/proxy/track?shop=s1.myshopify.com", { method: "POST", body: "{}" }) }, async () => new Response(null, { status: 500 }));
  await posthog.flush();
  const logs = sent.filter((e) => e.event === "api_request");
  assert.deepEqual(logs.map((l) => [l.properties.kind, l.properties.status]), [["document", 302], ["storefront", 500]]);
  assert.equal(logs[0].properties.redirect_to, "/auth/login");
  assert.equal(logs[1].properties.level, "error");
});
