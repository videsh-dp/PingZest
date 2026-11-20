/**
 * Message templates: our own text templates (not Meta-approved templates).
 * Variables use {curly} syntax and are filled from the order / checkout.
 */

export const TEMPLATE_TYPES = {
  cod_confirm: {
    label: "COD confirmation",
    help: "Sent after a Cash on Delivery order. Include {confirm_link} so the order is tagged automatically.",
    vars: ["name", "order_no", "amount", "items", "store_name", "confirm_link", "order_status_link"],
  },
  abandoned_cart: {
    label: "Abandoned checkout",
    help: "Sent to shoppers who left checkout. Include {checkout_link}.",
    vars: ["name", "amount", "items", "store_name", "checkout_link"],
  },
  shipped: {
    label: "Order shipped",
    help: "Sent when the order is fulfilled. Include {tracking_link} if available.",
    vars: ["name", "order_no", "amount", "items", "store_name", "tracking_link", "order_status_link"],
  },
  delivered: {
    label: "Order delivered",
    help: "Sent after delivery, e.g. to thank the customer or ask for a review.",
    vars: ["name", "order_no", "amount", "items", "store_name", "order_status_link"],
  },
};

export const LANGUAGES = { en: "English", hi: "Hindi" };

export const VARIABLES = {
  name: "Customer first name",
  order_no: "Order number, e.g. #1042",
  amount: "Order total, e.g. ₹1,299",
  items: "Short list of items",
  store_name: "Your store name",
  confirm_link: "Link to the confirm / cancel page (COD)",
  checkout_link: "Link back to the abandoned checkout",
  tracking_link: "Shipment tracking link",
  order_status_link: "Shopify order status page",
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
  },
  shipped: {
    en:
      "Hi {name}, good news! 🚚 Your order {order_no} from {store_name} has been shipped.\n\n" +
      "Track it here:\n{tracking_link}",
    hi:
      "नमस्ते {name}, खुशखबरी! 🚚 {store_name} से आपका ऑर्डर {order_no} भेज दिया गया है।\n\n" +
      "यहाँ ट्रैक करें:\n{tracking_link}",
  },
  delivered: {
    en:
      "Hi {name}, your order {order_no} has been delivered 🎉\n\n" +
      "We hope you love it! Reply here if you need any help. — {store_name}",
    hi:
      "नमस्ते {name}, आपका ऑर्डर {order_no} डिलीवर हो गया है 🎉\n\n" +
      "उम्मीद है आपको पसंद आएगा! किसी भी मदद के लिए यहीं जवाब दें। — {store_name}",
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
  abandoned_cart: {
    en: [["With urgency", "Hi {name}, your cart at {store_name} is still waiting 🛒\n\n{items}\n\n_Items sell out fast._ Complete your order:\n{checkout_link}"]],
    hi: [],
  },
  shipped: { en: [["Short", "🚚 {name}, your order {order_no} is on its way! Track: {tracking_link}"]], hi: [] },
  delivered: { en: [["Ask for a review", "Hi {name}, your order {order_no} was delivered 🎉\n\nHow did we do? Reply with a ⭐ rating from 1 to 5. — {store_name}"]], hi: [] },
};

/** Validate a template. Returns an error string or null. */
export function validateTemplate({ type, lang, name, body }) {
  if (!TEMPLATE_TYPES[type] || !LANGUAGES[lang]) return "Unknown stage or language.";
  if (!String(name || "").trim()) return "Give the template a name.";
  const text = String(body || "").trim();
  if (!text) return "The message can't be empty.";
  const { unknown } = renderTemplate(text, {});
  if (unknown.length) return `Unknown variable: ${unknown.map((u) => `{${u}}`).join(", ")}`;
  const notForType = [...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((v) => !TEMPLATE_TYPES[type].vars.includes(v));
  if (notForType.length) return `${[...new Set(notForType)].map((v) => `{${v}}`).join(", ")} isn't available for ${TEMPLATE_TYPES[type].label} messages.`;
  if (type === "cod_confirm" && !text.includes("{confirm_link}")) {
    return "Keep {confirm_link} in COD messages so customer replies are recorded automatically.";
  }
  return null;
}

