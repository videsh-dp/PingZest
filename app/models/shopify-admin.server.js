import { capture, captureException } from "../posthog.server";
import { sanitize } from "../lib/telemetry.js";

/**
 * Every Shopify Admin API call goes through here so it shows up in PostHog as "shopify_api_call":
 * operation name, duration, HTTP status, GraphQL errors, userErrors and query cost. Variables are
 * logged with customer data and secrets removed.
 */
async function callAdmin(admin, query, options = {}) {
  const operation = (String(query).match(/\b(query|mutation)\s+(\w+)/) || [])[2] || "anonymous";
  const type = /\bmutation\b/.test(String(query).split("{")[0]) ? "mutation" : "query";
  const started = Date.now();
  const base = { operation, operation_type: type, variables: sanitize(options.variables || {}) };
  let res;
  try {
    res = await admin.graphql(query, options);
  } catch (e) {
    capture("shopify_api_call", null, { ...base, ok: false, duration_ms: Date.now() - started, error: String(e?.message || e).slice(0, 500), status: e?.response?.code || e?.response?.status });
    captureException(e, null, { source: "shopify_api_call", operation });
    throw e;
  }
  try {
    const body = await res.clone().json();
    const errors = (body.errors || []).map((x) => x.message);
    const userErrors = Object.values(body.data || {}).flatMap((v) => (v && Array.isArray(v.userErrors) ? v.userErrors.map((u) => u.message) : []));
    capture("shopify_api_call", null, {
      ...base,
      ok: res.ok !== false && !errors.length,
      status: res.status,
      duration_ms: Date.now() - started,
      graphql_errors: errors.length ? errors : undefined,
      user_errors: userErrors.length ? userErrors : undefined,
      cost: body.extensions?.cost?.actualQueryCost,
      throttle_available: body.extensions?.cost?.throttleStatus?.currentlyAvailable,
      response: sanitize(body.data),
    });
  } catch {
    capture("shopify_api_call", null, { ...base, ok: res?.ok !== false, status: res?.status, duration_ms: Date.now() - started });
  }
  return res;
}

/**
 * Small wrappers around the Shopify Admin GraphQL API.
 * `admin` is the client from authenticate.admin / authenticate.webhook / unauthenticated.admin.
 */

export async function tagOrder(admin, orderGid, tags) {
  const res = await callAdmin(admin, 
    `#graphql
    mutation tagOrder($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
    }`,
    { variables: { id: orderGid, tags } },
  );
  const json = await res.json();
  const errors = json.data?.tagsAdd?.userErrors || [];
  if (errors.length) console.error("tagsAdd failed", errors);
  return errors.length === 0;
}

export async function removeOrderTags(admin, orderGid, tags) {
  const res = await callAdmin(admin, 
    `#graphql
    mutation untagOrder($id: ID!, $tags: [String!]!) {
      tagsRemove(id: $id, tags: $tags) { userErrors { field message } }
    }`,
    { variables: { id: orderGid, tags } },
  );
  const json = await res.json();
  return (json.data?.tagsRemove?.userErrors || []).length === 0;
}

export async function fetchShopName(admin) {
  const res = await callAdmin(admin, `#graphql
    query shopName { shop { name } }`);
  const json = await res.json();
  return json.data?.shop?.name || "";
}

/**
 * Webhook payloads can arrive with customer fields redacted (protected customer data).
 * When the phone is missing, fetch the order and shape it like a webhook payload.
 */
export async function fetchOrderAsPayload(admin, orderGid) {
  const res = await callAdmin(admin, 
    `#graphql
    query orderForWhatsApp($id: ID!) {
      order(id: $id) {
        id legacyResourceId name phone statusPageUrl paymentGatewayNames
        totalPriceSet { shopMoney { amount currencyCode } }
        customer { firstName phone }
        shippingAddress { firstName phone }
        billingAddress { firstName phone }
        customAttributes { key value }
        discountCodes
        totalDiscountsSet { shopMoney { amount } }
        lineItems(first: 10) { nodes { title quantity } }
      }
    }`,
    { variables: { id: orderGid } },
  );
  const o = (await res.json()).data?.order;
  if (!o) return null;
  return {
    id: o.legacyResourceId,
    admin_graphql_api_id: o.id,
    name: o.name,
    phone: o.phone,
    order_status_url: o.statusPageUrl,
    payment_gateway_names: o.paymentGatewayNames,
    total_price: o.totalPriceSet?.shopMoney?.amount,
    currency: o.totalPriceSet?.shopMoney?.currencyCode,
    customer: { first_name: o.customer?.firstName, phone: o.customer?.phone },
    shipping_address: { first_name: o.shippingAddress?.firstName, phone: o.shippingAddress?.phone },
    billing_address: { first_name: o.billingAddress?.firstName, phone: o.billingAddress?.phone },
    note_attributes: (o.customAttributes || []).map((a) => ({ name: a.key, value: a.value })),
    line_items: (o.lineItems?.nodes || []).map((li) => ({ title: li.title, quantity: li.quantity })),
    discount_codes: (o.discountCodes || []).map((code) => ({ code })),
    total_discounts: o.totalDiscountsSet?.shopMoney?.amount,
  };
}

/* ---------- widget config metafield ---------- */

export const CONFIG_NAMESPACE = "pingzest";
export const CONFIG_KEY = "config";

/**
 * Save widget settings to an app-owned metafield on the app installation.
 * The theme app embed reads it as {{ app.metafields.pingzest.config.value }}.
 */
export async function syncConfigMetafield(admin, config) {
  const idRes = await callAdmin(admin, `#graphql
    query appInstallation { currentAppInstallation { id } }`);
  const ownerId = (await idRes.json()).data?.currentAppInstallation?.id;
  if (!ownerId) throw new Error("Could not read app installation id");
  const res = await callAdmin(admin, 
    `#graphql
    mutation saveWidgetConfig($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { field message } }
    }`,
    {
      variables: {
        metafields: [{ ownerId, namespace: CONFIG_NAMESPACE, key: CONFIG_KEY, type: "json", value: JSON.stringify(config) }],
      },
    },
  );
  const errors = (await res.json()).data?.metafieldsSet?.userErrors || [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
}

/* ---------- discounts ---------- */

function discountInput(d) {
  const value =
    d.kind === "percentage"
      ? { percentage: Math.min(Math.max(d.value, 1), 100) / 100 }
      : { discountAmount: { amount: String(d.value), appliesOnEachItem: false } };
  return {
    title: d.title,
    code: d.code,
    startsAt: (d.startsAt || new Date()).toISOString(),
    endsAt: d.endsAt ? d.endsAt.toISOString() : null,
    // `context` replaced `customerSelection` in recent Admin API versions.
    context: { all: "ALL" },
    customerGets: { value, items: { all: true } },
    minimumRequirement: d.minSubtotal ? { subtotal: { greaterThanOrEqualToSubtotal: String(d.minSubtotal) } } : null,
    appliesOncePerCustomer: Boolean(d.oncePerCustomer),
    combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
  };
}

async function gql(admin, query, variables) {
  const res = await callAdmin(admin, query, { variables });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}

/** Returns { gid } or { error } */
export async function createCodeDiscount(admin, d) {
  const data = await gql(
    admin,
    `#graphql
    mutation createDiscount($input: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $input) {
        codeDiscountNode { id }
        userErrors { field message code }
      }
    }`,
    { input: discountInput(d) },
  );
  const r = data.discountCodeBasicCreate;
  if (r.userErrors?.length) return { error: r.userErrors.map((e) => e.message).join("; ") };
  return { gid: r.codeDiscountNode.id };
}

export async function setDiscountActive(admin, gid, active) {
  const field = active ? "discountCodeActivate" : "discountCodeDeactivate";
  const data = await gql(
    admin,
    `#graphql
    mutation toggleDiscount($id: ID!) {
      ${field}(id: $id) { userErrors { field message } }
    }`,
    { id: gid },
  );
  const errors = data[field]?.userErrors || [];
  return errors.length ? { error: errors.map((e) => e.message).join("; ") } : { ok: true };
}

export async function deleteCodeDiscount(admin, gid) {
  const data = await gql(
    admin,
    `#graphql
    mutation deleteDiscount($id: ID!) {
      discountCodeDelete(id: $id) { userErrors { field message } }
    }`,
    { id: gid },
  );
  const errors = data.discountCodeDelete?.userErrors || [];
  return errors.length ? { error: errors.map((e) => e.message).join("; ") } : { ok: true };
}

/** The store's languages (Settings → Languages): [{ locale: "es", name: "Spanish", primary, published }]. */
export async function getShopLocales(admin) {
  try {
    const data = await gql(admin, `#graphql
      query shopLocales { shopLocales { locale name primary published } }`);
    return data.shopLocales || [];
  } catch (e) {
    console.error("shopLocales failed", e?.message);
    return null; // unknown (e.g. scope not granted yet)
  }
}
