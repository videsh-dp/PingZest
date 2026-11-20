/**
 * Build the ready-to-send message + WhatsApp link from a template and row variables.
 * Pure: used by the queues in the browser (so switching templates is instant).
 */
import { renderTemplate } from "./templates.js";
import { waLink, prefillWarning } from "./whatsapp.js";

/** The confirm page opens in the same language as the message ("…/c/<token>?l=es"). */
export function withLang(link, lang) {
  if (!link || !lang || lang === "en") return link;
  return `${link}${link.includes("?") ? "&" : "?"}l=${encodeURIComponent(lang)}`;
}

export function composeMessage(body, vars, phone, lang = "en") {
  const v = vars?.confirm_link ? { ...vars, confirm_link: withLang(vars.confirm_link, lang) } : vars;
  const r = renderTemplate(body, v, { lang });
  return {
    message: r.text,
    missing: r.missing,
    warning: prefillWarning(r.text),
    link: phone ? waLink(phone, r.text) : null,
  };
}
