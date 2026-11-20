/**
 * React glue: <I18nProvider locale dict> at the top of the admin, useT() in components.
 * tr("English text", vars) returns the translation; tr.n / tr.money / tr.pct / tr.date / tr.ago
 * format with the merchant's language.
 */
import { createContext, useContext, useMemo } from "react";
import { createT, formatNumber, formatCurrency, formatPercent, formatDate, timeAgo, formatDurationMinutes, DEFAULT_LOCALE } from "./core.js";

const I18nContext = createContext(null);

export function makeTranslator(locale = DEFAULT_LOCALE, dict = {}) {
  const tr = createT(locale, dict);
  tr.n = (v) => formatNumber(v, locale);
  tr.money = (v, currency) => formatCurrency(v, currency, locale);
  tr.pct = (r) => formatPercent(r, locale);
  tr.date = (d, opts) => formatDate(d, locale, opts);
  tr.ago = (d) => timeAgo(d, locale);
  tr.duration = (min) => formatDurationMinutes(min, locale);
  return tr;
}

export function I18nProvider({ locale, dict, children }) {
  const value = useMemo(() => makeTranslator(locale, dict), [locale, dict]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const fallback = makeTranslator();
export function useT() {
  return useContext(I18nContext) || fallback;
}
