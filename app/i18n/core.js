/**
 * Translations with no dependencies: the English text is the key (gettext style),
 * so untranslated strings simply show in English. Formatting uses the platform's
 * built-in Intl API (numbers, currency, dates, relative time, plural rules).
 *
 * Add a language: create app/i18n/locales/<code>.json mapping English → translation,
 * add it to LOCALES below (scripts/translate-locale.mjs can draft the file).
 */

export const LOCALES = {
  en: { name: "English", native: "English", dir: "ltr" },
  hi: { name: "Hindi", native: "हिन्दी", dir: "ltr" },
  es: { name: "Spanish", native: "Español", dir: "ltr" },
  "pt-BR": { name: "Portuguese (Brazil)", native: "Português (Brasil)", dir: "ltr" },
  fr: { name: "French", native: "Français", dir: "ltr" },
  de: { name: "German", native: "Deutsch", dir: "ltr" },
  ar: { name: "Arabic", native: "العربية", dir: "rtl" },
};
export const DEFAULT_LOCALE = "en";

/** Marks a string for the translation catalog without translating it here (translate later with tr()). */
export const N_ = (s) => s;

/**
 * Pick the best supported locale from candidates such as "pt-PT", "es-419", "fr_CA",
 * an Accept-Language header, or undefined. Exact match first, then same language.
 */
export function resolveLocale(...candidates) {
  const list = candidates
    .flatMap((c) => (typeof c === "string" ? c.split(",") : []))
    .map((c) => c.split(";")[0].trim().replace("_", "-"))
    .filter(Boolean);
  const codes = Object.keys(LOCALES);
  for (const c of list) {
    const exact = codes.find((code) => code.toLowerCase() === c.toLowerCase());
    if (exact) return exact;
    const base = c.split("-")[0].toLowerCase();
    const sameLang = codes.find((code) => code.split("-")[0].toLowerCase() === base);
    if (sameLang) return sameLang;
  }
  return DEFAULT_LOCALE;
}

export const dirOf = (locale) => LOCALES[locale]?.dir || "ltr";

/** Replace {name} placeholders. Unknown placeholders are left as they are. */
export function interpolate(text, vars) {
  if (!vars) return text;
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

/**
 * Make a translate function.
 *   t("Save settings")
 *   t("{count} orders", { count: 3 })
 *   t.plural("{count} order needs confirmation", "{count} orders need confirmation", n)
 * Dictionaries may store plural forms as "English one|English other" keys mapped to an object
 * of Intl.PluralRules categories: { "one": "...", "few": "...", "other": "..." }.
 */
export function createT(locale = DEFAULT_LOCALE, dict = {}) {
  const t = (text, vars) => interpolate(typeof dict[text] === "string" && dict[text] ? dict[text] : text, vars);
  const rules = new Intl.PluralRules(locale === "pt-BR" ? "pt" : locale);
  t.plural = (one, other, count, vars = {}) => {
    const entry = dict[`${one}|${other}`];
    const all = { count, ...vars };
    if (entry && typeof entry === "object") {
      const cat = rules.select(count);
      return interpolate(entry[cat] || entry.other || other, all);
    }
    return t(count === 1 ? one : other, all);
  };
  t.locale = locale;
  t.dir = dirOf(locale);
  return t;
}

/* ---------- formatting with Intl ---------- */

const intlLocale = (locale) => (locale === "en" ? "en-IN" : locale === "hi" ? "hi-IN" : locale);

export function formatNumber(n, locale = "en") {
  return Number.isFinite(Number(n)) ? new Intl.NumberFormat(intlLocale(locale)).format(Number(n)) : "";
}

export function formatPercent(ratio, locale = "en") {
  if (ratio == null || !Number.isFinite(ratio)) return "–";
  return new Intl.NumberFormat(intlLocale(locale), { style: "percent", maximumFractionDigits: 1 }).format(ratio);
}

export function formatCurrency(amount, currency = "INR", locale = "en") {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function formatDate(date, locale = "en", opts = { day: "numeric", month: "short" }) {
  if (!date) return "";
  const d = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : new Date(date);
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: "UTC", ...opts }).format(d);
}

/** "5 minutes ago" / "hace 5 minutos" / "قبل ٥ دقائق" */
export function timeAgo(date, locale = "en", now = Date.now()) {
  if (!date) return "";
  const s = Math.round((new Date(date).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

/** "8 min", "2.5 hr", "1.2 days" in the given language (Intl unit formatting). */
export function formatDurationMinutes(minutes, locale = "en") {
  if (minutes == null || !Number.isFinite(minutes)) return "–";
  const f = (v, unit) => new Intl.NumberFormat(intlLocale(locale), { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: 1 }).format(v);
  if (minutes < 60) return f(Math.max(1, Math.round(minutes)), "minute");
  if (minutes < 1440) return f(Math.round((minutes / 60) * 10) / 10, "hour");
  return f(Math.round((minutes / 1440) * 10) / 10, "day");
}
