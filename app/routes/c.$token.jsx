/**
 * Public confirm page: https://<app>/c/<token>
 * Opened by the customer from the WhatsApp message. No login. The token is
 * random and expires; tapping Confirm/Cancel tags the order in Shopify.
 * Pro adds: "pay online now and save" (COD → prepaid) and fixing the delivery address.
 */
import { useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation, useRouteError, data, redirect } from "react-router";
import { unauthenticated } from "../shopify.server";
import { findByToken, setCodStatus } from "../models/orders.server";
import { getSettings } from "../models/settings.server";
import { tagOrder, removeOrderTags, fetchOrderForConfirm, updateShippingAddress, applyPrepaidDiscount } from "../models/shopify-admin.server";
import { hasFeature, planOf } from "../lib/plans.js";
import { prepaidDiscount, canOfferPrepaid, cleanAddressForm } from "../lib/prepaid.js";
import prisma from "../db.server";
import { capture } from "../posthog.server";
import { isValidTokenFormat } from "../lib/tokens.js";
import { resolveLocale, interpolate, dirOf, formatCurrency } from "../i18n/core.js";
import { CONFIRM_TEXTS } from "../i18n/confirm.js";
import { waLink } from "../lib/whatsapp.js";
import { appUrl } from "../models/messages.server";
import styles from "../styles/confirm.css?url";

export const links = () => [{ rel: "stylesheet", href: styles }];

/** Customer's language: the message's language (?l=), then their browser, then the shop default. */
function confirmLocale(request, settings) {
  const url = new URL(request.url);
  return resolveLocale(url.searchParams.get("l") || url.searchParams.get("lang"), request.headers.get("accept-language"), settings?.defaultLang);
}

const textsFor = (lang) => {
  const t = CONFIRM_TEXTS[lang] || CONFIRM_TEXTS.en;
  return (key, vars) => interpolate(t[key] ?? CONFIRM_TEXTS.en[key], vars);
};

async function load(token) {
  if (!isValidTokenFormat(token)) return null;
  const order = await findByToken(token);
  if (!order) return null;
  const settings = await getSettings(order.shop);
  return { order, settings };
}

/** Pro extras need the live order from Shopify (address, payment link). */
async function liveOrder(order, settings) {
  const plan = planOf(settings);
  const wantPrepaid = hasFeature(plan, "prepaidOffer") && settings.prepaidEnabled;
  const wantAddress = hasFeature(plan, "addressCheck") && settings.addressCheck;
  if ((!wantPrepaid && !wantAddress) || order.expired || order.shippedAt) return { wantPrepaid: false, wantAddress: false, live: null };
  try {
    const { admin } = await unauthenticated.admin(order.shop);
    return { wantPrepaid, wantAddress, live: await fetchOrderForConfirm(admin, order.orderGid), admin };
  } catch (e) {
    console.error("live order failed", e?.message);
    return { wantPrepaid: false, wantAddress: false, live: null };
  }
}

function extras(order, settings, lang, { wantPrepaid, wantAddress, live }) {
  const out = { prepaid: null, address: null };
  if (wantPrepaid && canOfferPrepaid(order, live)) {
    const subtotal = Number(live.currentSubtotalPriceSet?.shopMoney?.amount || 0);
    const currency = live.currentTotalPriceSet?.shopMoney?.currencyCode || order.currency;
    const saving = order.prepaidDiscount ? 0 : prepaidDiscount(subtotal, settings.prepaidPercent, settings.prepaidMaxAmount);
    const outstanding = Number(live.totalOutstandingSet?.shopMoney?.amount || 0);
    out.prepaid = {
      saving: saving > 0 ? formatCurrency(saving, currency, lang) : null,
      payAmount: formatCurrency(Math.max(0, outstanding - saving), currency, lang),
    };
  }
  const a = live?.shippingAddress;
  if (wantAddress && a && order.codStatus !== "cancelled") {
    out.address = {
      address1: a.address1 || "", address2: a.address2 || "", city: a.city || "", zip: a.zip || "",
      region: [a.province, a.country].filter(Boolean).join(", "), country: a.countryCodeV2 || "",
    };
  }
  return out;
}

function view(order, settings, lang) {
  return {
    lang,
    storeName: settings.storeName || order.shop.replace(".myshopify.com", ""),
    orderName: order.orderName,
    customerName: order.customerName,
    amount: formatCurrency(order.totalPrice, order.currency, lang),
    items: order.itemsSummary,
    status: order.codStatus,
    expired: Boolean(order.expired),
    locked: Boolean(order.shippedAt),
    storeChat: settings.whatsappNumber ? waLink(settings.whatsappNumber, textsFor(lang)("chat", { order: order.orderName })) : null,
    ogImage: `${appUrl()}/og-confirm.png`,
  };
}

export const loader = async ({ params, request }) => {
  const found = await load(params.token);
  if (!found) throw data({ lang: confirmLocale(request) }, { status: 404 });
  const lang = confirmLocale(request, found.settings);
  const ctx = await liveOrder(found.order, found.settings);
  return { ...view(found.order, found.settings, lang), ...extras(found.order, found.settings, lang, ctx), paidOnline: found.order.convertedToPrepaid };
};

export const action = async ({ params, request }) => {
  const found = await load(params.token);
  if (!found || found.order.expired || found.order.shippedAt) return data({ error: true }, { status: 400 });
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "prepay") return prepay(found);
  if (intent === "address") return fixAddress(found, Object.fromEntries(form));
  const choice = form.get("choice");
  if (!["confirmed", "cancelled"].includes(choice)) return data({ error: true }, { status: 400 });

  const { order, settings } = found;
  await setCodStatus(order.shop, order.id, choice, "customer");
  try {
    const { admin } = await unauthenticated.admin(order.shop);
    const add = choice === "confirmed" ? settings.confirmedTag : settings.cancelledTag;
    const remove = choice === "confirmed" ? settings.cancelledTag : settings.confirmedTag;
    await tagOrder(admin, order.orderGid, [add]);
    await removeOrderTags(admin, order.orderGid, [remove]);
  } catch (e) {
    // The choice is saved either way; the merchant sees it in the app.
    console.error("Tagging failed", e?.message);
  }
  return { ok: true };
};

/** Customer chose to pay online: apply the discount once, then send them to Shopify's payment page. */
async function prepay({ order, settings }) {
  const ctx = await liveOrder(order, settings);
  if (!ctx.wantPrepaid || !canOfferPrepaid(order, ctx.live)) return { error: "payFailed" };
  let discount = 0;
  if (!order.prepaidDiscount) {
    try {
      const subtotal = Number(ctx.live.currentSubtotalPriceSet?.shopMoney?.amount || 0);
      discount = await applyPrepaidDiscount(ctx.admin, order.orderGid, {
        percent: settings.prepaidPercent, maxAmount: settings.prepaidMaxAmount, subtotal, description: "Paid online (PingZest)",
      });
    } catch (e) {
      // Still let them pay, at the full price.
      console.error("prepaid discount failed", e?.message);
    }
  }
  await prisma.order.update({
    where: { id: order.id },
    data: { prepaidOfferedAt: new Date(), ...(discount > 0 ? { prepaidDiscount: String(discount) } : {}) },
  });
  // The payment link reflects the edited total, so read it again after the edit.
  const fresh = discount > 0 ? await fetchOrderForConfirm(ctx.admin, order.orderGid).catch(() => ctx.live) : ctx.live;
  const url = fresh?.paymentCollectionDetails?.additionalPaymentCollectionUrl;
  capture("cod_prepaid_clicked", order.shop, { discount, ok: Boolean(url) });
  if (!url) return { error: "payFailed" };
  return redirect(url);
}

async function fixAddress({ order, settings }, form) {
  const ctx = await liveOrder(order, settings);
  if (!ctx.wantAddress || !ctx.live?.shippingAddress) return { error: "addrFailed" };
  const clean = cleanAddressForm(form, ctx.live.shippingAddress.countryCodeV2);
  if (clean.error) return { error: "addrInvalid", field: clean.error };
  try {
    await updateShippingAddress(ctx.admin, order.orderGid, ctx.live.shippingAddress, clean.address);
    await prisma.order.update({ where: { id: order.id }, data: { addressUpdatedAt: new Date() } });
    capture("cod_address_fixed", order.shop, {});
    return { addressSaved: true };
  } catch (e) {
    console.error("address update failed", e?.message);
    return { error: "addrFailed" };
  }
}

export const meta = ({ data: d }) => {
  if (!d?.orderName) return [{ title: "Order" }, { name: "robots", content: "noindex" }];
  const t = textsFor(d.lang);
  return [
    { title: t("title", { order: d.orderName }) },
    { name: "robots", content: "noindex, nofollow" },
    { property: "og:title", content: t("title", { order: d.orderName }) },
    { property: "og:description", content: `${t("lead", { store: d.storeName })} · ${d.amount}` },
    { property: "og:image", content: d.ogImage },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:type", content: "website" },
  ];
};

export default function ConfirmPage() {
  const d = useLoaderData();
  const result = useActionData();
  const nav = useNavigation();
  const [editing, setEditing] = useState(false);
  const tx = textsFor(d.lang);
  const t = new Proxy({}, { get: (_, k) => tx(k) });
  const busy = nav.state !== "idle";
  const pendingChoice = nav.formData?.get("choice");
  const pendingIntent = nav.formData?.get("intent");
  const status = pendingChoice || d.status;
  const decided = status === "confirmed" || status === "cancelled";

  return (
    <main className="cf" lang={d.lang} dir={dirOf(d.lang)}>
      <div className="cf__card">
        <p className="cf__store">{d.storeName}</p>

        {d.expired ? (
          <Result icon="⏳" title={t.expired} sub={t.expiredSub} />
        ) : decided ? (
          <Result
            icon={status === "confirmed" ? "✅" : "❌"}
            title={status === "confirmed" ? t.confirmed : t.cancelled}
            sub={status === "confirmed" ? t.confirmedSub : t.cancelledSub}
          />
        ) : (
          <>
            <h1 className="cf__title">{tx("title", { order: d.orderName })}</h1>
            <p className="cf__lead">{tx("lead", { store: d.storeName })}</p>
          </>
        )}

        <dl className="cf__summary">
          <div><dt>{d.orderName}</dt><dd>{d.items}</dd></div>
          <div><dt>{t.total}</dt><dd className="cf__amount">{d.amount}</dd></div>
        </dl>

        {!d.expired && d.locked && <p className="cf__note">{t.locked}</p>}

        {!d.expired && !d.locked && (
          <Form method="post" className="cf__actions" onSubmit={(e) => {
            const c = e.nativeEvent.submitter?.value;
            if (c === "cancelled" && !window.confirm(t.confirmCancel)) e.preventDefault();
          }}>
            {decided && <p className="cf__change">{t.change}</p>}
            {status !== "confirmed" && (
              <button name="choice" value="confirmed" className="cf__btn cf__btn--yes" disabled={busy}>✅ {t.confirm}</button>
            )}
            {status !== "cancelled" && (
              <button name="choice" value="cancelled" className="cf__btn cf__btn--no" disabled={busy}>❌ {t.cancel}</button>
            )}
          </Form>
        )}

        {d.paidOnline && <p className="cf__note cf__note--ok">{t.paid}</p>}

        {d.prepaid && status !== "cancelled" && (
          <Form method="post" className="cf__pay">
            <input type="hidden" name="intent" value="prepay" />
            <h2 className="cf__h2">{d.prepaid.saving ? tx("payTitle", { amount: d.prepaid.saving }) : t.payTitleNoDiscount}</h2>
            <p className="cf__lead">{tx("paySub", { store: d.storeName })}</p>
            <button className="cf__btn cf__btn--pay" disabled={busy}>
              💳 {pendingIntent === "prepay" ? t.payOpening : tx("payBtn", { amount: d.prepaid.payAmount })}
            </button>
          </Form>
        )}
        {result?.error === "payFailed" && <p className="cf__note">{t.payFailed}</p>}

        {d.address && (
          <section className="cf__addr">
            <h2 className="cf__h2">{t.addrTitle}</h2>
            {result?.addressSaved && <p className="cf__note cf__note--ok" role="status">{t.addrSaved}</p>}
            {result?.error === "addrFailed" && <p className="cf__note">{t.addrFailed}</p>}
            {!editing ? (
              <>
                <address className="cf__address">
                  {d.address.address1}{d.address.address2 && <><br />{d.address.address2}</>}<br />
                  {d.address.city} <bdi dir="ltr">{d.address.zip}</bdi>{d.address.region && <><br />{d.address.region}</>}
                </address>
                <button type="button" className="cf__link" onClick={() => setEditing(true)}>{t.addrEdit}</button>
              </>
            ) : (
              <Form method="post" className="cf__form" onSubmit={() => setEditing(false)}>
                <input type="hidden" name="intent" value="address" />
                <label>{t.addrLine1}<input name="address1" defaultValue={d.address.address1} required minLength={5} maxLength={120} autoComplete="address-line1" /></label>
                <label>{t.addrLine2}<input name="address2" defaultValue={d.address.address2} maxLength={120} autoComplete="address-line2" /></label>
                <div className="cf__row">
                  <label>{t.addrCity}<input name="city" defaultValue={d.address.city} required maxLength={60} autoComplete="address-level2" /></label>
                  <label>{t.addrZip}<input name="zip" defaultValue={d.address.zip} required maxLength={12} inputMode={d.address.country === "IN" ? "numeric" : "text"} autoComplete="postal-code" dir="ltr" /></label>
                </div>
                <div className="cf__row">
                  <button className="cf__btn cf__btn--yes" disabled={busy}>{t.addrSave}</button>
                  <button type="button" className="cf__link" onClick={() => setEditing(false)}>{t.addrCancel}</button>
                </div>
              </Form>
            )}
            {result?.error === "addrInvalid" && <p className="cf__note">{t.addrInvalid}</p>}
          </section>
        )}

        {d.storeChat && <a className="cf__chat" href={d.storeChat}>{t.back}</a>}
      </div>
    </main>
  );
}

function Result({ icon, title, sub }) {
  return (
    <div className="cf__result" role="status">
      <span className="cf__icon" aria-hidden="true">{icon}</span>
      <h1 className="cf__title">{title}</h1>
      <p className="cf__lead">{sub}</p>
    </div>
  );
}

export function ErrorBoundary() {
  const lang = useRouteError()?.data?.lang || "en";
  const t = textsFor(lang);
  return (
    <main className="cf" lang={lang} dir={dirOf(lang)}>
      <div className="cf__card">
        <Result icon="🔍" title={t("notFound")} sub={t("expiredSub")} />
      </div>
    </main>
  );
}
