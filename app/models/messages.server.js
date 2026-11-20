/**
 * Row data for the queues: phone + template variables. The browser composes the final
 * message from the chosen template (app/lib/compose.js), so switching templates is instant.
 */
import { orderVars, checkoutVars } from "../lib/orders.js";
import { formatPhone } from "../lib/phone.js";
import { LOCALES } from "../i18n/core.js";

export function appUrl() {
  return (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
}

export function confirmLinkFor(order) {
  return order.confirmToken ? `${appUrl()}/c/${order.confirmToken}` : "";
}

export function codRowData(order, settings) {
  return {
    phone: order.phone,
    phoneDisplay: formatPhone(order.phone),
    vars: orderVars(order, { storeName: settings.storeName, confirmLink: confirmLinkFor(order) }),
  };
}

export function cartRowData(checkout, settings) {
  return {
    phone: checkout.phone,
    phoneDisplay: formatPhone(checkout.phone),
    vars: checkoutVars(checkout, { storeName: settings.storeName }),
  };
}

export function updateRowData(order, settings) {
  return {
    phone: order.phone,
    phoneDisplay: formatPhone(order.phone),
    vars: orderVars(order, { storeName: settings.storeName, trackingLink: order.trackingUrl || order.orderStatusUrl }),
  };
}

/** Templates for one stage, in the shape the queue picker needs. */
export function templatesFor(templates, type) {
  return templates.filter((t) => t.type === type).map((t) => ({ id: t.id, name: t.name, lang: t.lang, body: t.body, isDefault: t.isDefault }));
}

/** Language for this page: ?lang= overrides the shop default. */
export function pickLang(request, settings) {
  const q = new URL(request.url).searchParams.get("lang");
  return LOCALES[q] ? q : LOCALES[settings.defaultLang] ? settings.defaultLang : "en";
}
