/**
 * Widget settings: one JSON document per shop, edited in the app and saved to an
 * app-owned shop metafield (pingzest.config) that the theme app embed reads.
 *
 * Pure module: used by the admin (editor + validation) and mirrored by the
 * storefront script (widget-src/wa-widget.js, built into extensions/pingzest-widgets/assets/).
 */
import { N_ } from "../i18n/core.js";

export const CONFIG_VERSION = 1;

export const PAGE_TYPES = {
  index: N_("Home page"),
  product: N_("Product pages"),
  collection: N_("Collection pages"),
  "list-collections": N_("All collections"),
  cart: N_("Cart"),
  search: N_("Search results"),
  page: N_("Content pages"),
  blog: N_("Blog"),
  article: N_("Blog posts"),
  "404": N_("Not found page"),
};

export const POSITIONS = ["bottom-right", "bottom-left"];
export const CHAT_SHAPES = ["pill", "circle", "rounded"];
export const SIZES = ["sm", "md", "lg"];
export const ICONS = ["bubble", "phone", "send"];
export const BANNER_LAYOUTS = ["bar-top", "bar-bottom", "card", "popup"];
export const BANNER_SHAPES = ["square", "rounded", "pill"];
export const BUTTON_STYLES = ["solid", "outline"];
export const BUTTON_SHAPES = ["square", "rounded", "pill"];
export const RULE_MODES = ["all", "include", "exclude"];

const allPages = () => ({ mode: "all", pageTypes: [], paths: [] });

export function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    tracking: true,
    chat: {
      enabled: true,
      agents: [{ name: "Support", phone: "" }],
      countryCode: "91",
      greeting: "Hi! I have a question about your store.",
      productGreeting: "Hi! I have a question about {product}: {url}",
      popup: { enabled: true, title: "Chat with us", text: "We usually reply within a few minutes." },
      hours: { enabled: false, open: 10, close: 19, days: "mon_sat", utcOffset: 330 },
      offlineText: "We're offline right now. Leave a message and we'll reply when we open.",
      allowOffline: true,
      style: {
        shape: "pill",
        size: "md",
        bg: "#1f8f4e",
        fg: "#ffffff",
        icon: "bubble",
        label: "Chat with us",
        pulse: false,
        headerBg: "#1f8f4e",
      },
      tooltip: { enabled: true, text: "Need help? Chat with us 👋", delaySec: 6 },
      desktop: { show: true, position: "bottom-right", offsetX: 20, offsetY: 20 },
      mobile: { show: true, position: "bottom-right", offsetX: 16, offsetY: 16, iconOnly: true },
      pages: allPages(),
    },
    discount: {
      enabled: false,
      code: "",
      headline: "Get 10% off your first order",
      subtext: "Use code {code} at checkout",
      applyLabel: "Apply discount",
      copyLabel: "Copy code",
      layout: "bar-top",
      style: { bg: "#1c1c1c", fg: "#ffffff", accent: "#f5c542", shape: "rounded", size: "md" },
      showAfterSec: 0,
      dismissible: true,
      dismissDays: 3,
      desktop: { show: true },
      mobile: { show: true },
      pages: allPages(),
    },
    buttons: {
      style: "solid",
      shape: "rounded",
      size: "md",
      bg: "#1f8f4e",
      fg: "#ffffff",
      product: { pages: { mode: "include", pageTypes: ["product"], paths: [] } },
      cart: { pages: { mode: "include", pageTypes: ["cart"], paths: [] } },
      share: { pages: allPages() },
    },
    translations: {},
  };
}

/* ---------- validation helpers ---------- */

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const str = (v, fallback, max = 200) => (typeof v === "string" ? v.slice(0, max) : fallback);
const bool = (v, fallback) => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : fallback);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const int = (v, fallback, min, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};
const color = (v, fallback) => (typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim().toLowerCase() : fallback);

export function sanitizePageRules(input, fallback = allPages()) {
  if (!isObj(input)) return fallback;
  const pageTypes = Array.isArray(input.pageTypes) ? input.pageTypes.filter((p) => p in PAGE_TYPES) : [];
  const paths = (Array.isArray(input.paths) ? input.paths : String(input.paths || "").split(/[\n,]/))
    .map((p) => String(p).trim())
    .filter((p) => p.startsWith("/") && p.length <= 200)
    .slice(0, 30);
  return { mode: oneOf(input.mode, RULE_MODES, fallback.mode), pageTypes: [...new Set(pageTypes)], paths: [...new Set(paths)] };
}

/**
 * Merge user input over defaults, dropping anything unknown or invalid.
 * Never throws: bad values fall back to defaults.
 */
export function sanitizeConfig(input) {
  const d = defaultConfig();
  const i = isObj(input) ? input : {};
  const c = isObj(i.chat) ? i.chat : {};
  const cs = isObj(c.style) ? c.style : {};
  const ch = isObj(c.hours) ? c.hours : {};
  const cp = isObj(c.popup) ? c.popup : {};
  const ct = isObj(c.tooltip) ? c.tooltip : {};
  const cdk = isObj(c.desktop) ? c.desktop : {};
  const cmb = isObj(c.mobile) ? c.mobile : {};
  const ds = isObj(i.discount) ? i.discount : {};
  const dss = isObj(ds.style) ? ds.style : {};
  const b = isObj(i.buttons) ? i.buttons : {};

  const agents = (Array.isArray(c.agents) ? c.agents : [])
    .filter(isObj)
    .slice(0, 5)
    .map((a) => ({ name: str(a.name, "", 40).trim(), phone: str(a.phone, "", 24).trim() }))
    .filter((a) => a.name || a.phone);

  return {
    version: CONFIG_VERSION,
    tracking: bool(i.tracking, d.tracking),
    chat: {
      enabled: bool(c.enabled, d.chat.enabled),
      agents: agents.length ? agents : d.chat.agents,
      countryCode: str(c.countryCode, d.chat.countryCode, 4).replace(/\D/g, "") || "91",
      greeting: str(c.greeting, d.chat.greeting, 500),
      productGreeting: str(c.productGreeting, d.chat.productGreeting, 500),
      popup: {
        enabled: bool(cp.enabled, d.chat.popup.enabled),
        title: str(cp.title, d.chat.popup.title, 60),
        text: str(cp.text, d.chat.popup.text, 160),
      },
      hours: {
        enabled: bool(ch.enabled, d.chat.hours.enabled),
        open: int(ch.open, d.chat.hours.open, 0, 23),
        close: int(ch.close, d.chat.hours.close, 1, 24),
        days: oneOf(ch.days, ["all", "mon_sat", "mon_fri"], d.chat.hours.days),
        utcOffset: int(ch.utcOffset, d.chat.hours.utcOffset, -720, 840),
      },
      offlineText: str(c.offlineText, d.chat.offlineText, 200),
      allowOffline: bool(c.allowOffline, d.chat.allowOffline),
      style: {
        shape: oneOf(cs.shape, CHAT_SHAPES, d.chat.style.shape),
        size: oneOf(cs.size, SIZES, d.chat.style.size),
        bg: color(cs.bg, d.chat.style.bg),
        fg: color(cs.fg, d.chat.style.fg),
        icon: oneOf(cs.icon, ICONS, d.chat.style.icon),
        label: str(cs.label, d.chat.style.label, 40),
        pulse: bool(cs.pulse, d.chat.style.pulse),
        headerBg: color(cs.headerBg, d.chat.style.headerBg),
      },
      tooltip: {
        enabled: bool(ct.enabled, d.chat.tooltip.enabled),
        text: str(ct.text, d.chat.tooltip.text, 80),
        delaySec: int(ct.delaySec, d.chat.tooltip.delaySec, 0, 120),
      },
      desktop: {
        show: bool(cdk.show, d.chat.desktop.show),
        position: oneOf(cdk.position, POSITIONS, d.chat.desktop.position),
        offsetX: int(cdk.offsetX, d.chat.desktop.offsetX, 0, 200),
        offsetY: int(cdk.offsetY, d.chat.desktop.offsetY, 0, 300),
      },
      mobile: {
        show: bool(cmb.show, d.chat.mobile.show),
        position: oneOf(cmb.position, POSITIONS, d.chat.mobile.position),
        offsetX: int(cmb.offsetX, d.chat.mobile.offsetX, 0, 100),
        offsetY: int(cmb.offsetY, d.chat.mobile.offsetY, 0, 300),
        iconOnly: bool(cmb.iconOnly, d.chat.mobile.iconOnly),
      },
      pages: sanitizePageRules(c.pages, d.chat.pages),
    },
    discount: {
      enabled: bool(ds.enabled, d.discount.enabled),
      code: str(ds.code, "", 40).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ""),
      headline: str(ds.headline, d.discount.headline, 80),
      subtext: str(ds.subtext, d.discount.subtext, 140),
      applyLabel: str(ds.applyLabel, d.discount.applyLabel, 30),
      copyLabel: str(ds.copyLabel, d.discount.copyLabel, 30),
      layout: oneOf(ds.layout, BANNER_LAYOUTS, d.discount.layout),
      style: {
        bg: color(dss.bg, d.discount.style.bg),
        fg: color(dss.fg, d.discount.style.fg),
        accent: color(dss.accent, d.discount.style.accent),
        shape: oneOf(dss.shape, BANNER_SHAPES, d.discount.style.shape),
        size: oneOf(dss.size, SIZES, d.discount.style.size),
      },
      showAfterSec: int(ds.showAfterSec, d.discount.showAfterSec, 0, 120),
      dismissible: bool(ds.dismissible, d.discount.dismissible),
      dismissDays: int(ds.dismissDays, d.discount.dismissDays, 0, 90),
      desktop: { show: bool(ds.desktop?.show, true) },
      mobile: { show: bool(ds.mobile?.show, true) },
      pages: sanitizePageRules(ds.pages, d.discount.pages),
    },
    buttons: {
      style: oneOf(b.style, BUTTON_STYLES, d.buttons.style),
      shape: oneOf(b.shape, BUTTON_SHAPES, d.buttons.shape),
      size: oneOf(b.size, SIZES, d.buttons.size),
      bg: color(b.bg, d.buttons.bg),
      fg: color(b.fg, d.buttons.fg),
      product: { pages: sanitizePageRules(b.product?.pages, d.buttons.product.pages) },
      cart: { pages: sanitizePageRules(b.cart?.pages, d.buttons.cart.pages) },
      share: { pages: sanitizePageRules(b.share?.pages, d.buttons.share.pages) },
    },
    translations: sanitizeTranslations(i.translations),
  };
}

/* ---------- per-language texts (mirrored in wa-widget.js) ---------- */

/** Texts a merchant can translate per store language, with their max length. */
export const TRANSLATABLE = {
  "chat.style.label": 40,
  "chat.tooltip.text": 80,
  "chat.popup.title": 60,
  "chat.popup.text": 160,
  "chat.offlineText": 200,
  "chat.greeting": 500,
  "chat.productGreeting": 500,
  "discount.headline": 80,
  "discount.subtext": 140,
  "discount.applyLabel": 30,
  "discount.copyLabel": 30,
};

const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/** { es: { "chat.greeting": "Hola…" }, … } — unknown keys and empty texts dropped. */
export function sanitizeTranslations(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [locale, texts] of Object.entries(input).slice(0, 30)) {
    if (!LOCALE_RE.test(locale) || !texts || typeof texts !== "object") continue;
    const clean = {};
    for (const [path, max] of Object.entries(TRANSLATABLE)) {
      const v = typeof texts[path] === "string" ? texts[path].trim().slice(0, max) : "";
      if (v) clean[path] = v;
    }
    if (Object.keys(clean).length) out[locale] = clean;
  }
  return out;
}

export function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/* ---------- page rules (mirrored in wa-widget.js) ---------- */

/** "/products/*" style patterns; "*" matches anything, trailing slash ignored. */
export function pathMatches(pattern, path) {
  const norm = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : p).toLowerCase();
  const escaped = norm(pattern).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${escaped}$`).test(norm(path));
}

/**
 * Should a widget show on this page?
 * @param {{mode:string,pageTypes:string[],paths:string[]}} rules
 * @param {{pageType:string,path:string}} page  path without locale prefix, e.g. "/products/kurta"
 */
export function matchesPage(rules, page) {
  if (!rules || rules.mode === "all") return true;
  const hit =
    (rules.pageTypes || []).includes(page.pageType) ||
    (rules.paths || []).some((p) => pathMatches(p, page.path || "/"));
  return rules.mode === "include" ? hit : !hit;
}

/** Shopify's built-in link that applies a code to the shopper's cart, then returns to `redirect`. */
export function discountApplyUrl(code, redirect = "/") {
  return `/discount/${encodeURIComponent(code)}?redirect=${encodeURIComponent(redirect)}`;
}

/** Summary for the editor: "Product pages, Cart · /pages/contact" */
export function describeRules(rules) {
  if (!rules || rules.mode === "all") return "All pages";
  const parts = [...(rules.pageTypes || []).map((t) => PAGE_TYPES[t]), ...(rules.paths || [])];
  const list = parts.length ? parts.join(", ") : "nothing selected";
  return rules.mode === "include" ? `Only on: ${list}` : `Everywhere except: ${list}`;
}
