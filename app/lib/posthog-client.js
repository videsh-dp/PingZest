/**
 * Tiny PostHog client for the server (no npm package needed): batched events, exceptions,
 * and feature flags. Talks to PostHog's public HTTP API:
 *   POST {host}/batch/      events
 *   POST {host}/flags/?v=2  feature flags for one distinct id
 * With no API key every call is a no-op, so local development works without PostHog.
 */
import { exceptionProperties } from "./telemetry.js";

export function createPostHog({
  apiKey,
  host = "https://us.i.posthog.com",
  fetchImpl = globalThis.fetch,
  flushAt = 20,
  flushIntervalMs = 3000,
  flagsTtlMs = 60_000,
  defaults = {},
  onError = (e) => console.error("[posthog]", e?.message || e),
  now = () => Date.now(),
} = {}) {
  const enabled = Boolean(apiKey);
  const base = String(host).replace(/\/$/, "");
  let queue = [];
  let timer = null;
  const flagCache = new Map();

  function schedule() {
    if (timer || !enabled) return;
    timer = setTimeout(() => { timer = null; flush(); }, flushIntervalMs);
    timer.unref?.();
  }

  /** Queue an event. distinctId: the shop domain (or "server"). */
  function capture(event, distinctId, properties = {}, { personProfile = false } = {}) {
    if (!enabled) return;
    queue.push({
      event,
      distinct_id: distinctId || "server",
      timestamp: new Date(now()).toISOString(),
      properties: {
        distinct_id: distinctId || "server",
        $lib: "pingzest-server",
        // Request logs don't need a person profile; that keeps them cheap on the free plan.
        ...(personProfile ? {} : { $process_person_profile: false }),
        ...properties,
      },
    });
    if (queue.length >= flushAt) flush();
    else schedule();
  }

  function captureException(error, distinctId, properties = {}) {
    capture("$exception", distinctId, exceptionProperties(error, properties));
  }

  /** Set properties on the shop's profile (plan, language…) so flags can target them. */
  function identify(distinctId, set = {}) {
    capture("$identify", distinctId, { $set: set }, { personProfile: true });
  }

  async function flush() {
    if (!enabled || !queue.length) return;
    const batch = queue;
    queue = [];
    try {
      const res = await fetchImpl(`${base}/batch/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, batch }),
      });
      if (!res.ok) onError(new Error(`PostHog batch failed: ${res.status}`));
    } catch (e) {
      onError(e);
    }
  }

  /**
   * Feature flags for a shop: { "flag-key": true | false | "variant" }.
   * Missing flags fall back to `defaults`, and so does everything if PostHog can't be reached.
   */
  async function getFlags(distinctId, { personProperties } = {}) {
    if (!enabled) return { ...defaults };
    const key = distinctId || "server";
    const hit = flagCache.get(key);
    if (hit && now() - hit.at < flagsTtlMs) return hit.flags;
    let flags = { ...defaults };
    try {
      const res = await fetchImpl(`${base}/flags/?v=2`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, distinct_id: key, ...(personProperties ? { person_properties: personProperties } : {}) }),
      });
      if (!res.ok) throw new Error(`PostHog flags failed: ${res.status}`);
      flags = { ...defaults, ...parseFlags(await res.json()) };
    } catch (e) {
      onError(e);
      if (hit) return hit.flags; // keep the last known values rather than flipping features off
    }
    flagCache.set(key, { at: now(), flags });
    return flags;
  }

  async function shutdown() {
    clearTimeout(timer);
    timer = null;
    await flush();
  }

  return { enabled, capture, captureException, identify, flush, getFlags, shutdown, _queue: () => queue };
}

/** Accepts the /flags v2 shape ({ flags: { key: { enabled, variant } } }) and the older { featureFlags }. */
export function parseFlags(json) {
  const out = {};
  if (json?.flags && typeof json.flags === "object") {
    for (const [k, f] of Object.entries(json.flags)) out[k] = f?.enabled ? (f.variant ?? true) : false;
  } else if (json?.featureFlags && typeof json.featureFlags === "object") {
    for (const [k, v] of Object.entries(json.featureFlags)) out[k] = v;
  }
  return out;
}
