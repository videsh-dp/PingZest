/**
 * WhatsApp click-to-chat link builders.
 *
 * These links only open a chat with the text already typed in.
 * A human must press send. Never automate sending through WhatsApp Web:
 * it breaks WhatsApp's terms and gets numbers banned.
 */

/** Pre-filled text above this length can get cut off on some devices. */
export const MAX_PREFILL_LENGTH = 1500;

/**
 * Link that opens a chat with `phone` and `text` typed in.
 * Works on phones (opens the app) and desktop (WhatsApp Web / Desktop).
 * @param {string|null} phone digits-only international number; null = let the user pick a contact
 * @param {string} text
 */
export function waLink(phone, text = "") {
  const base = phone ? `https://wa.me/${phone}` : "https://wa.me/";
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/** Share link: opens WhatsApp so the user can pick who to send `text` to. */
export function waShareLink(text) {
  return waLink(null, text);
}

/**
 * "Reply button" imitation: a link that, when the customer taps it,
 * opens a chat with the merchant with e.g. "CONFIRM #1234" already typed.
 */
export function replyLink(merchantPhone, replyText) {
  return waLink(merchantPhone, replyText);
}

/** Warn the merchant in the UI if a message is likely to be cut off. */
export function prefillWarning(text) {
  if (!text) return null;
  if (text.length > MAX_PREFILL_LENGTH) {
    return `This message is ${text.length} characters. Messages over ${MAX_PREFILL_LENGTH} may be cut off. Shorten the template.`;
  }
  return null;
}
