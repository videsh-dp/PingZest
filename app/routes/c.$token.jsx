/**
 * Public confirm page: https://<app>/c/<token>
 * Opened by the customer from the WhatsApp message. No login. The token is
 * random and expires; tapping Confirm/Cancel tags the order in Shopify.
 */
import { Form, useLoaderData, useNavigation, data } from "react-router";
import { unauthenticated } from "../shopify.server";
import { findByToken, setCodStatus } from "../models/orders.server";
import { getSettings } from "../models/settings.server";
import { tagOrder, removeOrderTags } from "../models/shopify-admin.server";
import { isValidTokenFormat } from "../lib/tokens.js";
import { formatMoney } from "../lib/orders.js";
import { waLink } from "../lib/whatsapp.js";
import { appUrl } from "../models/messages.server";
import styles from "../styles/confirm.css?url";

export const links = () => [{ rel: "stylesheet", href: styles }];

const T = {
  en: {
    title: (o) => `Confirm your order ${o}`,
    lead: (s) => `Your Cash on Delivery order from ${s}`,
    confirm: "Confirm order", cancel: "Cancel order", total: "Total to pay on delivery",
    confirmed: "Thank you! Your order is confirmed.", confirmedSub: "We'll ship it soon and keep you posted on WhatsApp.",
    cancelled: "Your order has been cancelled.", cancelledSub: "Changed your mind? Message us and we'll help.",
    expired: "This link has expired.", expiredSub: "Please message the store on WhatsApp to confirm your order.",
    notFound: "We couldn't find this order.", locked: "This order has already shipped, so it can't be changed here.",
    back: "Message the store on WhatsApp", change: "Changed your mind?", confirmCancel: "Cancel this order?",
  },
  hi: {
    title: (o) => `अपना ऑर्डर ${o} कन्फर्म करें`,
    lead: (s) => `${s} से आपका कैश ऑन डिलीवरी ऑर्डर`,
    confirm: "ऑर्डर कन्फर्म करें", cancel: "ऑर्डर कैंसल करें", total: "डिलीवरी पर देय राशि",
    confirmed: "धन्यवाद! आपका ऑर्डर कन्फर्म हो गया है।", confirmedSub: "हम जल्द ही इसे भेजेंगे और WhatsApp पर अपडेट देंगे।",
    cancelled: "आपका ऑर्डर कैंसल कर दिया गया है।", cancelledSub: "मन बदल गया? हमें मैसेज करें, हम मदद करेंगे।",
    expired: "यह लिंक एक्सपायर हो गया है।", expiredSub: "कृपया ऑर्डर कन्फर्म करने के लिए स्टोर को WhatsApp पर मैसेज करें।",
    notFound: "यह ऑर्डर नहीं मिला।", locked: "यह ऑर्डर भेजा जा चुका है, इसलिए यहाँ बदला नहीं जा सकता।",
    back: "स्टोर को WhatsApp पर मैसेज करें", change: "मन बदल गया?", confirmCancel: "क्या यह ऑर्डर कैंसल करें?",
  },
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
    amount: formatMoney(order.totalPrice, order.currency),
    items: order.itemsSummary,
    status: order.codStatus,
    expired: Boolean(order.expired),
    locked: Boolean(order.shippedAt),
    storeChat: settings.whatsappNumber ? waLink(settings.whatsappNumber, `Hi, about my order ${order.orderName}`) : null,
    ogImage: `${appUrl()}/og-confirm.png`,
  };
}

export const loader = async ({ params, request }) => {
  const found = await load(params.token);
  const qLang = new URL(request.url).searchParams.get("lang");
  if (!found) throw data({ lang: qLang === "hi" ? "hi" : "en" }, { status: 404 });
  const lang = ["en", "hi"].includes(qLang) ? qLang : found.settings.defaultLang || "en";
  return view(found.order, found.settings, lang);
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
  const t = T[d.lang] || T.en;
  return [
    { title: t.title(d.orderName) },
    { name: "robots", content: "noindex, nofollow" },
    { property: "og:title", content: t.title(d.orderName) },
    { property: "og:description", content: `${t.lead(d.storeName)} · ${d.amount}` },
    { property: "og:image", content: d.ogImage },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:type", content: "website" },
  ];
};

export default function ConfirmPage() {
  const d = useLoaderData();
  const nav = useNavigation();
  const t = T[d.lang] || T.en;
  const busy = nav.state !== "idle";
  const pendingChoice = nav.formData?.get("choice");
  const status = pendingChoice || d.status;
  const decided = status === "confirmed" || status === "cancelled";

  return (
    <main className="cf" lang={d.lang}>
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
            <h1 className="cf__title">{t.title(d.orderName)}</h1>
            <p className="cf__lead">{t.lead(d.storeName)}</p>
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
  return (
    <main className="cf">
      <div className="cf__card">
        <Result icon="🔍" title={T.en.notFound} sub={T.en.expiredSub} />
      </div>
    </main>
  );
}
