/**
 * Work out the admin language for a request:
 * 1. the merchant's choice in Settings (unless "auto")
 * 2. Shopify admin language (?locale= on embedded loads, or the staff member's session locale)
 * 3. the browser's Accept-Language
 */
import { resolveLocale } from "./core.js";
import { DICTIONARIES } from "./dictionaries.js";

export function adminLocale({ request, session, settings }) {
  if (settings?.appLocale && settings.appLocale !== "auto") return resolveLocale(settings.appLocale);
  const url = new URL(request.url);
  return resolveLocale(url.searchParams.get("locale"), session?.locale, request.headers.get("accept-language"));
}

/** Language for public pages (landing, login, confirm page): ?lang= then the browser. */
export function browserLocale(request, ...fallbacks) {
  const url = new URL(request.url);
  return resolveLocale(url.searchParams.get("lang"), request.headers.get("accept-language"), ...fallbacks);
}

export function dictionaryFor(locale) {
  return DICTIONARIES[locale] || {};
}
