/**
 * A fake Shopify for end-to-end tests: answers the Admin GraphQL API, token exchange and billing the way
 * Shopify does, for one shop. It listens on HTTPS :443 with a self-signed certificate; CI points the shop's
 * hostname at 127.0.0.1 (/etc/hosts) and trusts the certificate (NODE_EXTRA_CA_CERTS), so the app talks to
 * it exactly as it would talk to https://<shop>/admin/api/... — no app code knows it's a test.
 *
 * Every call is recorded in `calls` ({ op, variables, query }) so tests can check what the app asked for.
 */
import { createServer } from "node:https";
import { existsSync, readFileSync } from "node:fs";

/**
 * With Shopify's real Admin schema (E2E_ADMIN_SCHEMA, downloaded by scripts/fetch-admin-schema.mjs) every
 * query and its variables are checked like Shopify checks them: unknown fields, wrong argument or input
 * types and missing required inputs come back as GraphQL errors and are recorded as `graphql_error` calls.
 */
async function loadValidator() {
  const path = process.env.E2E_ADMIN_SCHEMA;
  if (!path || !existsSync(path)) return null;
  const g = await import("graphql");
  const schema = g.buildClientSchema(JSON.parse(readFileSync(path, "utf8")));
  return (query, variables) => {
    let doc;
    try { doc = g.parse(query); } catch (e) { return [e.message]; }
    const errors = g.validate(schema, doc).map((e) => e.message);
    if (errors.length) return errors;
    const opDef = doc.definitions.find((d) => d.kind === "OperationDefinition");
    const coerced = g.getVariableValues(schema, opDef.variableDefinitions || [], variables || {});
    return (coerced.errors || []).map((e) => e.message);
  };
}

export async function startFakeShopify({ port = 443, cert, key, scopes }) {
  const validate = await loadValidator();
  if (validate) console.log("[fake-shopify] validating queries against the real Admin API schema");
  const calls = [];
  const state = {
    subscription: null, // { id, name, status, trialDays, createdAt, test }
    orders: new Map(), // gid -> order fields used by orderForConfirm / orderForWhatsApp
    metafields: [],
    discounts: new Map(),
    nextId: 1000,
    failNext: null, // op name whose next call returns userErrors
  };

  const newId = (type) => `gid://shopify/${type}/${state.nextId++}`;
  const userErrors = (op) => {
    if (state.failNext === op) { state.failNext = null; return [{ field: ["id"], message: `Fake failure in ${op}` }]; }
    return [];
  };

  function findFulfillmentOrder(id) {
    for (const o of state.orders.values()) {
      const fo = (o.fulfillmentOrders || []).find((f) => f.id === id);
      if (fo) return fo;
    }
    return null;
  }

  function subscriptionNode(s) {
    return {
      id: s.id, name: s.name, test: s.test ?? true, status: s.status, trialDays: s.trialDays ?? 7,
      createdAt: s.createdAt, currentPeriodEnd: null, returnUrl: "https://admin.shopify.com/",
      lineItems: [{ id: `${s.id}-line`, plan: { pricingDetails: { __typename: "AppRecurringPricing", interval: "EVERY_30_DAYS", price: { amount: "9.99", currencyCode: "USD" } } } }],
    };
  }

  /** Returns `data` for one GraphQL request. */
  function resolve(query, variables) {
    const op = (query.match(/\b(?:query|mutation)\s+(\w+)/) || [])[1] || "anonymous";
    calls.push({ op, variables, query });

    // ---- billing (queries written by @shopify/shopify-api, matched by content) ----
    if (/appSubscriptionCreate/.test(query)) {
      const id = newId("AppSubscription");
      state.pending = { id, name: variables?.name, status: "PENDING", createdAt: new Date().toISOString(), trialDays: variables?.trialDays ?? 7 };
      return { appSubscriptionCreate: { appSubscription: subscriptionNode(state.pending), confirmationUrl: `https://admin.shopify.com/charges/confirm?id=${encodeURIComponent(id)}`, userErrors: [] } };
    }
    if (/appSubscriptionCancel/.test(query)) {
      const sub = state.subscription ? { ...state.subscription, status: "CANCELLED" } : { id: variables?.id, name: "", status: "CANCELLED" };
      state.subscription = null;
      return { appSubscriptionCancel: { appSubscription: subscriptionNode(sub), userErrors: [] } };
    }
    if (/activeSubscriptions|oneTimePurchases/.test(query)) {
      const active = state.subscription && ["ACTIVE", "PENDING"].includes(state.subscription.status) ? [subscriptionNode(state.subscription)] : [];
      return {
        currentAppInstallation: {
          id: "gid://shopify/AppInstallation/1",
          activeSubscriptions: active,
          oneTimePurchases: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } },
        },
      };
    }

    switch (op) {
      case "shopName":
        return { shop: { name: "CI Test Store" } };
      case "appInstallation":
        return { currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } };
      case "saveWidgetConfig":
        state.metafields.push(...(variables?.metafields || []));
        return { metafieldsSet: { metafields: [], userErrors: userErrors(op) } };
      case "shopLocales":
        return { shopLocales: [
          { locale: "en", name: "English", primary: true, published: true },
          { locale: "hi", name: "Hindi", primary: false, published: true },
          { locale: "es", name: "Spanish", primary: false, published: false },
        ] };
      case "createDiscount": {
        const errs = userErrors(op);
        if (errs.length) return { discountCodeBasicCreate: { codeDiscountNode: null, userErrors: errs } };
        const id = newId("DiscountCodeNode");
        state.discounts.set(id, { ...variables.input, active: true });
        return { discountCodeBasicCreate: { codeDiscountNode: { id }, userErrors: [] } };
      }
      case "toggleDiscount": {
        const field = /discountCodeActivate/.test(query) ? "discountCodeActivate" : "discountCodeDeactivate";
        const d = state.discounts.get(variables?.id);
        if (d) d.active = field === "discountCodeActivate";
        return { [field]: { userErrors: userErrors(op) } };
      }
      case "deleteDiscount":
        state.discounts.delete(variables?.id);
        return { discountCodeDelete: { deletedCodeDiscountId: variables?.id, userErrors: userErrors(op) } };
      case "tagOrder":
      case "untagOrder": {
        const o = state.orders.get(variables?.id);
        if (o) {
          o.tags = new Set(o.tags || []);
          for (const t of variables.tags) op === "tagOrder" ? o.tags.add(t) : o.tags.delete(t);
        }
        const field = op === "tagOrder" ? "tagsAdd" : "tagsRemove";
        return { [field]: { node: { id: variables?.id }, userErrors: userErrors(op) } };
      }
      case "orderForWhatsApp": {
        const o = state.orders.get(variables?.id);
        return { order: o?.payload || null };
      }
      case "orderForConfirm": {
        const o = state.orders.get(variables?.id);
        if (!o) return { order: null };
        return { order: {
          id: variables.id, cancelledAt: null, displayFinancialStatus: o.financialStatus || "PENDING", displayFulfillmentStatus: "UNFULFILLED",
          currentTotalPriceSet: { shopMoney: { amount: String(o.total ?? "1299.00"), currencyCode: "INR" } },
          currentSubtotalPriceSet: { shopMoney: { amount: String(o.subtotal ?? o.total ?? "1299.00"), currencyCode: "INR" } },
          totalOutstandingSet: { shopMoney: { amount: String(o.outstanding ?? o.total ?? "1299.00"), currencyCode: "INR" } },
          paymentCollectionDetails: { additionalPaymentCollectionUrl: o.paymentUrl ?? `https://ci-store.myshopify.com/pay/${variables.id.split("/").pop()}` },
          shippingAddress: o.shippingAddress || { firstName: "Priya", lastName: "Shah", company: null, address1: "Flat 402, Sunrise Apartments, MG Road", address2: "Near City Mall", city: "Pune", provinceCode: "MH", province: "Maharashtra", zip: "411001", countryCodeV2: "IN", country: "India", phone: "+919812345678" },
        } };
      }
      case "fixAddress": {
        const o = state.orders.get(variables?.input?.id);
        if (o) o.shippingAddress = { ...(o.shippingAddress || {}), ...variables.input.shippingAddress, countryCodeV2: variables.input.shippingAddress.countryCode };
        return { orderUpdate: { order: { id: variables?.input?.id }, userErrors: userErrors(op) } };
      }
      // ---- closing the COD loop: fulfillment holds and cancel + restock ----
      case "codFulfillmentOrders": {
        const o = state.orders.get(variables?.id);
        if (!o) return { order: null };
        if (!o.fulfillmentOrders) o.fulfillmentOrders = [{ id: newId("FulfillmentOrder"), status: "OPEN", holds: [] }];
        return { order: {
          id: variables.id, cancelledAt: o.cancelledAt || null, displayFulfillmentStatus: "UNFULFILLED",
          fulfillmentOrders: { nodes: o.fulfillmentOrders.map((fo) => ({ id: fo.id, status: fo.status })) },
        } };
      }
      case "holdFulfillmentOrder": {
        const errs = userErrors(op);
        const fo = findFulfillmentOrder(variables?.id);
        if (errs.length || !fo) return { fulfillmentOrderHold: { fulfillmentHold: null, fulfillmentOrder: null, userErrors: errs.length ? errs : [{ field: ["id"], message: "Fulfillment order not found" }] } };
        const hold = { id: newId("FulfillmentHold"), reason: variables.fulfillmentHold.reason, notes: variables.fulfillmentHold.reasonNotes };
        fo.holds.push(hold);
        fo.status = "ON_HOLD";
        return { fulfillmentOrderHold: { fulfillmentHold: { id: hold.id }, fulfillmentOrder: { id: fo.id, status: fo.status }, userErrors: [] } };
      }
      case "releaseFulfillmentHold": {
        const errs = userErrors(op);
        const fo = findFulfillmentOrder(variables?.id);
        if (errs.length || !fo) return { fulfillmentOrderReleaseHold: { fulfillmentOrder: null, userErrors: errs.length ? errs : [{ field: ["id"], message: "Fulfillment order not found" }] } };
        fo.holds = variables.holdIds ? fo.holds.filter((h) => !variables.holdIds.includes(h.id)) : [];
        if (!fo.holds.length) fo.status = "OPEN";
        return { fulfillmentOrderReleaseHold: { fulfillmentOrder: { id: fo.id, status: fo.status }, userErrors: [] } };
      }
      case "cancelOrder": {
        const errs = userErrors(op);
        if (errs.length) return { orderCancel: { job: null, orderCancelUserErrors: errs.map((e) => ({ ...e, code: "INVALID" })) } };
        const o = state.orders.get(variables?.orderId);
        if (o) Object.assign(o, { cancelledAt: new Date().toISOString(), cancelReason: variables.reason, restocked: variables.restock, cancelNote: variables.staffNote });
        return { orderCancel: { job: { id: newId("Job"), done: false }, orderCancelUserErrors: [] } };
      }
      case "beginEdit":
        return { orderEditBegin: { calculatedOrder: { id: newId("CalculatedOrder"), lineItems: { nodes: [{ id: newId("CalculatedLineItem"), quantity: 1 }] } }, userErrors: userErrors(op) } };
      case "discountLine":
        return { orderEditAddLineItemDiscount: { userErrors: userErrors(op) } };
      case "commitEdit":
        return { orderEditCommit: { order: { id: "gid://shopify/Order/edited" }, userErrors: userErrors(op) } };
      default:
        console.warn(`[fake-shopify] unhandled GraphQL operation ${op}`);
        return {};
    }
  }

  const server = createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url, "https://fake");
      res.setHeader("content-type", "application/json");
      // Token exchange (embedded apps): offline and online access tokens.
      if (url.pathname === "/admin/oauth/access_token") {
        let body = {};
        try { body = JSON.parse(raw); } catch { body = Object.fromEntries(new URLSearchParams(raw)); }
        calls.push({ op: "token_exchange", variables: { requested_token_type: body.requested_token_type } });
        const online = String(body.requested_token_type || "").includes("online");
        res.end(JSON.stringify(online
          ? { access_token: "shpua_fake_online", scope: scopes, expires_in: 86399, associated_user_scope: scopes,
              associated_user: { id: 42, first_name: "Asha", last_name: "Patel", email: "asha@example.com", email_verified: true, account_owner: true, locale: "en", collaborator: false } }
          : { access_token: "shpat_fake_offline", scope: scopes }));
        return;
      }
      if (/^\/admin\/api\/[^/]+\/graphql\.json$/.test(url.pathname)) {
        let body = {};
        try { body = JSON.parse(raw); } catch { /* empty */ }
        const query = String(body.query || "");
        const problems = validate ? validate(query, body.variables) : [];
        if (problems.length) {
          const op = (query.match(/\b(?:query|mutation)\s+(\w+)/) || [])[1] || "anonymous";
          calls.push({ op: "graphql_error", variables: { operation: op, errors: problems }, query });
          console.error(`[fake-shopify] ${op} rejected by the Admin schema: ${problems.join(" | ")}`);
          res.end(JSON.stringify({ errors: problems.map((message) => ({ message })) }));
          return;
        }
        const data = resolve(query, body.variables || {});
        res.end(JSON.stringify({ data, extensions: { cost: { actualQueryCost: 1, throttleStatus: { currentlyAvailable: 1999 } } } }));
        return;
      }
      calls.push({ op: `unhandled ${req.method} ${url.pathname}` });
      console.warn(`[fake-shopify] unhandled ${req.method} ${url.pathname}`);
      res.statusCode = 404;
      res.end(JSON.stringify({ errors: "Not Found" }));
    });
  });
  return await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => ok({ calls, state, close: () => server.close(), opsCalled: () => calls.map((c) => c.op) }));
  });
}
