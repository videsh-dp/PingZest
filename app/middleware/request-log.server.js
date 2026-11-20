/**
 * Logs every request the app handles to PostHog as "api_request":
 * method, path, kind (document / data / webhook / storefront / confirm_page / auth), shop,
 * status, duration, query and form parameters, and JSON response bodies, with customer data and
 * secrets removed (see app/lib/telemetry.js). 5xx responses and thrown errors also go to PostHog
 * error tracking ($exception) via handleError in entry.server.jsx.
 *
 * Volume: the storefront click counter (/apps/pingzest/track) runs on every shopper page view, so
 * it is sampled (POSTHOG_STOREFRONT_SAMPLE, default 0.01 = 1%) to stay inside PostHog's free
 * 1M events/month. Failed storefront requests are always logged.
 */
import { randomUUID } from "node:crypto";
import { capture, requestContext } from "../posthog.server.js";
import { cleanPath, queryParams, requestBody, responseBody, shopFromRequest, requestKind, levelFor } from "../lib/telemetry.js";

const STOREFRONT_SAMPLE = Number(process.env.POSTHOG_STOREFRONT_SAMPLE ?? 0.01);

export async function requestLog({ request }, next) {
  const started = Date.now();
  const url = new URL(request.url);
  const kind = requestKind(request);
  const shop = shopFromRequest(request);
  const requestId = request.headers.get("x-request-id") || randomUUID();
  const path = cleanPath(url.pathname);
  // Webhook bodies are full orders/customers: log the topic and id, not the payload.
  const body = kind === "webhook" ? undefined : await requestBody(request);

  return requestContext.run({ shop, requestId, path }, async () => {
    let response;
    let thrown;
    try {
      response = await next();
    } catch (e) {
      thrown = e;
    }
    // Thrown Responses (redirects, auth bounces) are normal in Shopify apps.
    const res = response || (thrown instanceof Response ? thrown : null);
    const status = res?.status ?? 500;
    const sampledOut = kind === "storefront" && status < 400 && Math.random() >= STOREFRONT_SAMPLE;
    if (!sampledOut) {
      capture("api_request", shop, {
        request_id: requestId,
        method: request.method,
        path,
        kind,
        status,
        level: levelFor(status),
        duration_ms: Date.now() - started,
        query: queryParams(request.url),
        body,
        response: res ? await responseBody(res) : undefined,
        response_type: res?.headers.get("content-type") || undefined,
        redirect_to: res && status >= 300 && status < 400 ? cleanPath(res.headers.get("location") || "") : undefined,
        webhook_topic: request.headers.get("x-shopify-topic") || undefined,
        webhook_id: request.headers.get("x-shopify-webhook-id") || undefined,
        user_agent_bot: /bot|crawl|spider/i.test(request.headers.get("user-agent") || "") || undefined,
        sample_rate: kind === "storefront" && status < 400 ? STOREFRONT_SAMPLE : undefined,
        $current_url: `${url.origin}${path}`,
      });
    }
    if (thrown) throw thrown;
    return response;
  });
}
