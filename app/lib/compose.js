/**
 * Build the ready-to-send message + WhatsApp link from a template and row variables.
 * Pure: used by the queues in the browser (so switching templates is instant).
 */
import { renderTemplate } from "./templates.js";
import { waLink, prefillWarning } from "./whatsapp.js";

export function composeMessage(body, vars, phone, lang = "en") {
  const r = renderTemplate(body, vars, { lang });
  return {
    message: r.text,
    missing: r.missing,
    warning: prefillWarning(r.text),
    link: phone ? waLink(phone, r.text) : null,
  };
}
