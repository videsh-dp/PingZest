/**
 * The app's PostHog connection (server side). Set POSTHOG_API_KEY (the project key, phc_…) and
 * optionally POSTHOG_HOST (https://us.i.posthog.com or https://eu.i.posthog.com).
 * Without a key nothing is sent and feature flags use their defaults.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createPostHog } from "./lib/posthog-client.js";
import { FLAG_DEFAULTS, isOn } from "./lib/flags.js";

function make() {
  const client = createPostHog({
    apiKey: process.env.POSTHOG_API_KEY,
    host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    defaults: FLAG_DEFAULTS,
  });
  if (client.enabled) {
    // Errors that escape everything else: report, then crash as Node would have (the host restarts it).
    const fatal = (source) => (e) => {
      console.error(e);
      client.captureException(e, "server", { handled: false, source });
      const exit = () => process.exit(1);
      setTimeout(exit, 2000).unref();
      client.flush().finally(exit);
    };
    process.on("uncaughtException", fatal("uncaughtException"));
    process.on("unhandledRejection", fatal("unhandledRejection"));
    for (const sig of ["SIGTERM", "SIGINT"]) process.once(sig, () => client.shutdown().finally(() => process.exit(0)));
    process.once("beforeExit", () => client.shutdown());
  }
  return client;
}

// One client per process (Vite reloads modules in development).
const posthog = globalThis.__posthog || make();
if (process.env.NODE_ENV !== "production") globalThis.__posthog = posthog;

/**
 * Per-request context (shop, request id), set by the request-log middleware, so anything logged
 * while handling a request (Admin API calls, errors…) is tied to that request in PostHog.
 */
export const requestContext = globalThis.__phContext || new AsyncLocalStorage();
globalThis.__phContext = requestContext;
const ctx = () => requestContext.getStore() || {};

export default posthog;
export const capture = (event, shop, props = {}) =>
  posthog.capture(event, shop || ctx().shop || "server", { request_id: ctx().requestId, ...props });
export const captureException = (error, shop, props = {}) =>
  posthog.captureException(error, shop || ctx().shop || "server", { request_id: ctx().requestId, path: ctx().path, ...props });
export const getFlags = (shop, opts) => posthog.getFlags(shop || "server", opts);

/** One feature flag for a shop, as a boolean (see app/lib/flags.js for keys and defaults). */
export async function flagOn(shop, key) {
  return isOn(await getFlags(shop), key);
}

// Shop profile in PostHog (plan, language), so flags can target "plan = free" etc. At most hourly per shop.
const identified = new Map();
export function identifyShop(shop, props) {
  if (!shop || !posthog.enabled) return;
  const key = `${shop}:${JSON.stringify(props)}`;
  if (Date.now() - (identified.get(key) || 0) < 3600_000) return;
  identified.set(key, Date.now());
  posthog.identify(shop, { shop, ...props });
}

/** Public settings for the browser snippet (the project key is meant to be public). */
export function browserConfig() {
  return process.env.POSTHOG_API_KEY
    ? { key: process.env.POSTHOG_API_KEY, host: process.env.POSTHOG_HOST || "https://us.i.posthog.com" }
    : null;
}

/** Time an outbound call (Shopify Admin API, Google…) and log it; failures also go to error tracking. */
export async function trackCall(event, shop, props, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    capture(event, shop, { ...props, ok: true, duration_ms: Date.now() - started });
    return result;
  } catch (e) {
    capture(event, shop, { ...props, ok: false, duration_ms: Date.now() - started, error: String(e?.message || e).slice(0, 500) });
    captureException(e, shop, { source: event, ...props });
    throw e;
  }
}
