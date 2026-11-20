/**
 * Public confirm page: https://<app>/c/<token>
 * Opened by the customer from the WhatsApp message. No login. The token is
 * random and expires; tapping Confirm/Cancel tags the order in Shopify.
 */
import { Form, useLoaderData, useNavigation, useRouteError, data } from "react-router";
import { unauthenticated } from "../shopify.server";
import { findByToken, setCodStatus } from "../models/orders.server";
import { getSettings } from "../models/settings.server";
import { tagOrder, removeOrderTags } from "../models/shopify-admin.server";
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
  return view(found.order, found.settings, confirmLocale(request, found.settings));
};

export const action = async ({ params, request }) => {
  const found = await load(params.token);
  if (!found || found.order.expired || found.order.shippedAt) return data({ error: true }, { status: 400 });
  const form = await request.formData();
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
  const nav = useNavigation();
  const tx = textsFor(d.lang);
  const t = new Proxy({}, { get: (_, k) => tx(k) });
  const busy = nav.state !== "idle";
  const pendingChoice = nav.formData?.get("choice");
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
