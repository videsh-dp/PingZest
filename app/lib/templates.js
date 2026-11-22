/**
 * Message templates: our own text templates (not Meta-approved templates).
 * Variables use {curly} syntax and are filled from the order / checkout.
 */
import { N_, LOCALES } from "../i18n/core.js";

export const TEMPLATE_TYPES = {
  cod_confirm: {
    label: N_("COD confirmation"),
    help: N_("Sent after a Cash on Delivery order. Include {confirm_link} so the order is tagged automatically."),
    vars: ["name", "order_no", "amount", "items", "store_name", "confirm_link", "order_status_link"],
  },
  cod_reminder: {
    label: N_("COD reminder"),
    help: N_("Sent to customers who haven't confirmed their COD order yet (COD confirmation → To remind). Include {confirm_link}."),
    vars: ["name", "order_no", "amount", "items", "store_name", "confirm_link", "order_status_link"],
  },
  abandoned_cart: {
    label: N_("Abandoned checkout"),
    help: N_("Sent to shoppers who left checkout. Include {checkout_link}."),
    vars: ["name", "amount", "items", "store_name", "checkout_link"],
  },
  shipped: {
    label: N_("Order shipped"),
    help: N_("Sent when the order is fulfilled. Include {tracking_link} if available."),
    vars: ["name", "order_no", "amount", "items", "store_name", "tracking_link", "order_status_link"],
  },
  delivered: {
    label: N_("Order delivered"),
    help: N_("Sent after delivery, e.g. to thank the customer or ask for a review."),
    vars: ["name", "order_no", "amount", "items", "store_name", "order_status_link"],
  },
};

/** Message languages: every language the app supports (names in their own language). */
export const LANGUAGES = Object.fromEntries(Object.entries(LOCALES).map(([code, l]) => [code, l.native]));

export const VARIABLES = {
  name: N_("Customer first name"),
  order_no: N_("Order number, e.g. #1042"),
  amount: N_("Order total, e.g. ₹1,299"),
  items: N_("Short list of items"),
  store_name: N_("Your store name"),
  confirm_link: N_("Link to the confirm / cancel page (COD)"),
  checkout_link: N_("Link back to the abandoned checkout"),
  tracking_link: N_("Shipment tracking link"),
  order_status_link: N_("Shopify order status page"),
};

export const DEFAULT_TEMPLATES = {
  cod_confirm: {
    en:
      "Hi {name}, thank you for shopping with {store_name}! 🛍️\n\n" +
      "Your order {order_no} of *{amount}* is booked as *Cash on Delivery*.\n\n" +
      "Please tap to confirm or cancel your order:\n{confirm_link}",
    hi:
      "नमस्ते {name}, {store_name} से खरीदारी के लिए धन्यवाद! 🛍️\n\n" +
      "आपका ऑर्डर {order_no} (*{amount}*) *कैश ऑन डिलीवरी* के रूप में बुक हुआ है।\n\n" +
      "कृपया अपना ऑर्डर कन्फर्म या कैंसल करने के लिए यहाँ टैप करें:\n{confirm_link}",
    es:
      "Hola {name}, ¡gracias por comprar en {store_name}! 🛍️\n\n" +
      "Tu pedido {order_no} de *{amount}* está registrado como *pago contra reembolso*.\n\n" +
      "Toca para confirmar o cancelar tu pedido:\n{confirm_link}",
    "pt-BR":
      "Olá {name}, obrigado por comprar na {store_name}! 🛍️\n\n" +
      "Seu pedido {order_no} de *{amount}* foi registrado com *pagamento na entrega*.\n\n" +
      "Toque para confirmar ou cancelar seu pedido:\n{confirm_link}",
    fr:
      "Bonjour {name}, merci pour votre commande chez {store_name} ! 🛍️\n\n" +
      "Votre commande {order_no} de *{amount}* est enregistrée en *paiement à la livraison*.\n\n" +
      "Touchez le lien pour confirmer ou annuler votre commande :\n{confirm_link}",
    de:
      "Hallo {name}, danke für deinen Einkauf bei {store_name}! 🛍️\n\n" +
      "Deine Bestellung {order_no} über *{amount}* ist als *Nachnahme* gebucht.\n\n" +
      "Bitte tippe hier, um deine Bestellung zu bestätigen oder zu stornieren:\n{confirm_link}",
    ar:
      "مرحبًا {name}، شكرًا لتسوقك من {store_name}! 🛍️\n\n" +
      "طلبك {order_no} بقيمة *{amount}* مسجَّل *بالدفع عند الاستلام*.\n\n" +
      "اضغط لتأكيد طلبك أو إلغائه:\n{confirm_link}",
  },
  cod_reminder: {
    en:
      "Hi {name}, a quick reminder from {store_name} 🙏\n\n" +
      "Your Cash on Delivery order {order_no} (*{amount}*) is waiting for your confirmation. We ship it as soon as you confirm.\n\n" +
      "Tap to confirm or cancel:\n{confirm_link}",
    hi:
      "नमस्ते {name}, {store_name} की ओर से एक छोटा-सा रिमाइंडर 🙏\n\n" +
      "आपका कैश ऑन डिलीवरी ऑर्डर {order_no} (*{amount}*) आपके कन्फर्मेशन का इंतज़ार कर रहा है। कन्फर्म करते ही हम इसे भेज देंगे।\n\n" +
      "कन्फर्म या कैंसल करने के लिए टैप करें:\n{confirm_link}",
    es:
      "Hola {name}, un recordatorio rápido de {store_name} 🙏\n\n" +
      "Tu pedido contra reembolso {order_no} (*{amount}*) espera tu confirmación. Lo enviamos en cuanto confirmes.\n\n" +
      "Toca para confirmar o cancelar:\n{confirm_link}",
    "pt-BR":
      "Olá {name}, um lembrete rápido da {store_name} 🙏\n\n" +
      "Seu pedido com pagamento na entrega {order_no} (*{amount}*) está aguardando sua confirmação. Enviamos assim que você confirmar.\n\n" +
      "Toque para confirmar ou cancelar:\n{confirm_link}",
    fr:
      "Bonjour {name}, un petit rappel de {store_name} 🙏\n\n" +
      "Votre commande {order_no} (*{amount}*) en paiement à la livraison attend votre confirmation. Nous l'expédions dès que vous confirmez.\n\n" +
      "Touchez pour confirmer ou annuler :\n{confirm_link}",
    de:
      "Hallo {name}, eine kurze Erinnerung von {store_name} 🙏\n\n" +
      "Deine Nachnahme-Bestellung {order_no} (*{amount}*) wartet auf deine Bestätigung. Wir versenden sie, sobald du bestätigst.\n\n" +
      "Hier tippen, um zu bestätigen oder zu stornieren:\n{confirm_link}",
    ar:
      "مرحبًا {name}، تذكير سريع من {store_name} 🙏\n\n" +
      "طلبك {order_no} (*{amount}*) بالدفع عند الاستلام بانتظار تأكيدك. نشحنه فور تأكيدك.\n\n" +
      "اضغط للتأكيد أو الإلغاء:\n{confirm_link}",
  },
  abandoned_cart: {
    en:
      "Hi {name}, you left something in your cart at {store_name} 👀\n\n" +
      "{items}\nTotal: *{amount}*\n\n" +
      "Complete your order here:\n{checkout_link}",
    hi:
      "नमस्ते {name}, {store_name} पर आपके कार्ट में कुछ सामान रह गया है 👀\n\n" +
      "{items}\nकुल: *{amount}*\n\n" +
      "अपना ऑर्डर यहाँ पूरा करें:\n{checkout_link}",
    es:
      "Hola {name}, dejaste algo en tu carrito de {store_name} 👀\n\n" +
      "{items}\nTotal: *{amount}*\n\n" +
      "Completa tu pedido aquí:\n{checkout_link}",
    "pt-BR":
      "Olá {name}, você deixou algo no seu carrinho da {store_name} 👀\n\n" +
      "{items}\nTotal: *{amount}*\n\n" +
      "Finalize seu pedido aqui:\n{checkout_link}",
    fr:
      "Bonjour {name}, vous avez oublié quelque chose dans votre panier chez {store_name} 👀\n\n" +
      "{items}\nTotal : *{amount}*\n\n" +
      "Finalisez votre commande ici :\n{checkout_link}",
    de:
      "Hallo {name}, in deinem Warenkorb bei {store_name} liegt noch etwas 👀\n\n" +
      "{items}\nSumme: *{amount}*\n\n" +
      "Schließe deine Bestellung hier ab:\n{checkout_link}",
    ar:
      "مرحبًا {name}، تركت شيئًا في سلتك لدى {store_name} 👀\n\n" +
      "{items}\nالإجمالي: *{amount}*\n\n" +
      "أكمل طلبك من هنا:\n{checkout_link}",
  },
  shipped: {
    en:
      "Hi {name}, good news! 🚚 Your order {order_no} from {store_name} has been shipped.\n\n" +
      "Track it here:\n{tracking_link}",
    hi:
      "नमस्ते {name}, खुशखबरी! 🚚 {store_name} से आपका ऑर्डर {order_no} भेज दिया गया है।\n\n" +
      "यहाँ ट्रैक करें:\n{tracking_link}",
    es:
      "Hola {name}, ¡buenas noticias! 🚚 Tu pedido {order_no} de {store_name} ya está en camino.\n\n" +
      "Síguelo aquí:\n{tracking_link}",
    "pt-BR":
      "Olá {name}, boa notícia! 🚚 Seu pedido {order_no} da {store_name} foi enviado.\n\n" +
      "Acompanhe aqui:\n{tracking_link}",
    fr:
      "Bonjour {name}, bonne nouvelle ! 🚚 Votre commande {order_no} de {store_name} a été expédiée.\n\n" +
      "Suivez-la ici :\n{tracking_link}",
    de:
      "Hallo {name}, gute Nachrichten! 🚚 Deine Bestellung {order_no} von {store_name} wurde versendet.\n\n" +
      "Hier verfolgen:\n{tracking_link}",
    ar:
      "مرحبًا {name}، خبر سار! 🚚 تم شحن طلبك {order_no} من {store_name}.\n\n" +
      "تتبّعه من هنا:\n{tracking_link}",
  },
  delivered: {
    en:
      "Hi {name}, your order {order_no} has been delivered 🎉\n\n" +
      "We hope you love it! Reply here if you need any help. — {store_name}",
    hi:
      "नमस्ते {name}, आपका ऑर्डर {order_no} डिलीवर हो गया है 🎉\n\n" +
      "उम्मीद है आपको पसंद आएगा! किसी भी मदद के लिए यहीं जवाब दें। — {store_name}",
    es:
      "Hola {name}, tu pedido {order_no} ha sido entregado 🎉\n\n" +
      "¡Esperamos que te encante! Responde aquí si necesitas ayuda. — {store_name}",
    "pt-BR":
      "Olá {name}, seu pedido {order_no} foi entregue 🎉\n\n" +
      "Esperamos que você ame! Responda aqui se precisar de ajuda. — {store_name}",
    fr:
      "Bonjour {name}, votre commande {order_no} a été livrée 🎉\n\n" +
      "Nous espérons qu'elle vous plaira ! Répondez ici si vous avez besoin d'aide. — {store_name}",
    de:
      "Hallo {name}, deine Bestellung {order_no} wurde zugestellt 🎉\n\n" +
      "Wir hoffen, sie gefällt dir! Antworte hier, wenn du Hilfe brauchst. — {store_name}",
    ar:
      "مرحبًا {name}، تم تسليم طلبك {order_no} 🎉\n\n" +
      "نتمنى أن ينال إعجابك! رد هنا إذا احتجت أي مساعدة. — {store_name}",
  },
};

/** Fallbacks so a message never shows an empty gap. */
const FALLBACKS = {
  name: { en: "there", hi: "जी" },
};

/**
 * Fill a template.
 * @param {string} text  template with {variables}
 * @param {Record<string, string|number|null|undefined>} vars
 * @param {{ lang?: string }} [opts]
 * @returns {{ text: string, missing: string[], unknown: string[] }}
 */
export function renderTemplate(text, vars = {}, opts = {}) {
  const lang = opts.lang || "en";
  const missing = [];
  const unknown = [];
  const out = String(text || "").replace(/\{([a-z_]+)\}/g, (match, key) => {
    if (!(key in VARIABLES)) {
      unknown.push(key);
      return match; // leave typos visible so the merchant notices
    }
    const value = vars[key];
    if (value === null || value === undefined || value === "") {
      const fb = FALLBACKS[key]?.[lang] ?? FALLBACKS[key]?.en;
      if (fb) return fb;
      missing.push(key);
      return "";
    }
    return String(value);
  });
  // tidy blank lines left by empty variables
  const tidy = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: tidy, missing: [...new Set(missing)], unknown: [...new Set(unknown)] };
}

/**
 * Choose which template to use.
 * @param {Array<{id,type,lang,body,isDefault,name}>} saved  the shop's templates
 * @param {string} type
 * @param {string} lang
 * @param {number|string} [templateId]  explicit choice (e.g. from the queue picker)
 * @returns {{ id: number|null, name: string, body: string }}
 */
export function pickTemplate(saved, type, lang = "en", templateId) {
  const list = (Array.isArray(saved) ? saved : []).filter((t) => t.type === type);
  const byId = templateId != null && templateId !== "" ? list.find((t) => String(t.id) === String(templateId)) : null;
  const sameLang = list.filter((t) => t.lang === lang);
  const t = byId || sameLang.find((x) => x.isDefault) || sameLang[0];
  if (t) return { id: t.id, name: t.name || "Template", body: t.body };
  return { id: null, name: "Standard", body: DEFAULT_TEMPLATES[type]?.[lang] ?? DEFAULT_TEMPLATES[type]?.en ?? "" };
}

/** Back-compat helper: just the text. */
export function getTemplateText(saved, type, lang = "en", templateId) {
  return pickTemplate(saved, type, lang, templateId).body;
}

/** Extra starting points offered when creating a template. */
export const STARTER_TEMPLATES = {
  cod_confirm: {
    en: [
      ["Short & friendly", "Hi {name} 👋 Please confirm your COD order {order_no} (*{amount}*):\n{confirm_link}"],
      ["Detailed", "Hello {name},\n\nThank you for your order with *{store_name}*.\n\n> Order: {order_no}\n> Items: {items}\n> To pay on delivery: *{amount}*\n\nPlease confirm so we can ship it today:\n{confirm_link}"],
    ],
    hi: [["छोटा", "नमस्ते {name} 👋 कृपया अपना COD ऑर्डर {order_no} (*{amount}*) कन्फर्म करें:\n{confirm_link}"]],
  },
  cod_reminder: {
    en: [["Short", "Hi {name}, just checking 🙂 Shall we ship your order {order_no} (*{amount}*)? Tap to confirm: {confirm_link}"]],
    hi: [["छोटा", "नमस्ते {name} 🙂 क्या हम आपका ऑर्डर {order_no} (*{amount}*) भेज दें? कन्फर्म करने के लिए टैप करें: {confirm_link}"]],
  },
  abandoned_cart: {
    en: [["With urgency", "Hi {name}, your cart at {store_name} is still waiting 🛒\n\n{items}\n\n_Items sell out fast._ Complete your order:\n{checkout_link}"]],
    hi: [],
  },
  shipped: { en: [["Short", "🚚 {name}, your order {order_no} is on its way! Track: {tracking_link}"]], hi: [] },
  delivered: { en: [["Ask for a review", "Hi {name}, your order {order_no} was delivered 🎉\n\nHow did we do? Reply with a ⭐ rating from 1 to 5. — {store_name}"]], hi: [] },
};

/** Validate a template. Returns an error string or null. */
export function validateTemplate({ type, lang, name, body }) {
  if (!TEMPLATE_TYPES[type] || !LANGUAGES[lang]) return N_("Unknown stage or language.");
  if (!String(name || "").trim()) return N_("Give the template a name.");
  const text = String(body || "").trim();
  if (!text) return N_("The message can't be empty.");
  const { unknown } = renderTemplate(text, {});
  if (unknown.length) return `Unknown variable: ${unknown.map((u) => `{${u}}`).join(", ")}`;
  const notForType = [...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((v) => !TEMPLATE_TYPES[type].vars.includes(v));
  if (notForType.length) return `${[...new Set(notForType)].map((v) => `{${v}}`).join(", ")} isn't available for ${TEMPLATE_TYPES[type].label} messages.`;
  if ((type === "cod_confirm" || type === "cod_reminder") && !text.includes("{confirm_link}")) {
    return N_("Keep {confirm_link} in COD messages so customer replies are recorded automatically.");
  }
  return null;
}

