/**
 * Machine translation of merchant text (templates, widget texts) with Google Cloud Translation.
 * Optional: only enabled when GOOGLE_TRANSLATE_API_KEY is set.
 *
 * Before sending, {variables}, links and WhatsApp formatting markers are swapped for
 * placeholders Google won't touch, then restored. Pure helpers are exported for tests.
 */

const TOKEN_RE = /(\{[a-z_]+\}|https?:\/\/[^\s]+|```|\*|_|~|`)/g;

/** Replace things that must not be translated with <x id="N"/> tags (Google keeps tags in html mode). */
export function protect(text) {
  const kept = [];
  const html = String(text)
    .replace(TOKEN_RE, (m) => {
      kept.push(m);
      return `\u0001${kept.length - 1}\u0001`;
    })
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\u0001(\d+)\u0001/g, '<x id="$1"/>')
    .replace(/\n/g, "<br/>");
  return { html, kept };
}

export function restore(html, kept) {
  return String(html)
    .replace(/<br\s*\/?>\s?/gi, "\n")
    .replace(/<x id="(\d+)"\s*\/?>(<\/x>)?/gi, (_, i) => kept[Number(i)] ?? "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/** Google language codes for our locales. */
export const googleCode = (locale) => (locale === "pt-BR" ? "pt" : locale.split("-")[0]);

export function translationEnabled() {
  return Boolean(process.env.GOOGLE_TRANSLATE_API_KEY);
}

/**
 * Translate several strings at once. Returns translated strings in the same order.
 * Throws a readable error if the API key is missing or Google rejects the request.
 */
export async function translateTexts(texts, target, source, fetchImpl = fetch) {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!key) throw new Error("Auto-translate needs GOOGLE_TRANSLATE_API_KEY on the server.");
  const items = texts.map((t) => protect(t || ""));
  const res = await fetchImpl(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: items.map((i) => i.html),
      target: googleCode(target),
      ...(source ? { source: googleCode(source) } : {}),
      format: "html",
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Translate: ${json?.error?.message || res.status}`);
  const out = json?.data?.translations || [];
  return items.map((item, i) => (texts[i] ? restore(out[i]?.translatedText ?? item.html, item.kept) : ""));
}
