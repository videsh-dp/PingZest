/**
 * Phone number helpers.
 *
 * WhatsApp click-to-chat links need the number in international format,
 * digits only, without "+" or leading zeros: e.g. 919876543210.
 */

const NATIONAL_LENGTH = {
  91: 10, // India
  1: 10, // US / Canada
  44: 10, // UK (without leading 0)
  971: 9, // UAE
  65: 8, // Singapore
  61: 9, // Australia
};

/**
 * Normalise a phone number typed by a shopper.
 *
 * @param {string|number|null|undefined} raw  e.g. "098765 43210", "+91-98765-43210", "9876543210"
 * @param {string} defaultCountryCode         digits only, e.g. "91"
 * @returns {string|null} digits-only international number, or null if it can't be valid
 */
export function normalizePhone(raw, defaultCountryCode = "91") {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;

  const cc = String(defaultCountryCode || "").replace(/\D/g, "");
  const hasPlus = s.startsWith("+");
  let digits = s.replace(/\D/g, "");
  if (!digits) return null;

  if (hasPlus) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.replace(/^00/, "");
  } else if (digits.startsWith("0")) {
    // national trunk prefix: 098765 43210 -> 9876543210
    digits = cc + digits.replace(/^0+/, "");
  } else if (cc) {
    const national = NATIONAL_LENGTH[cc];
    if (national && digits.length === national) {
      digits = cc + digits;
    } else if (!national && digits.length <= 10) {
      digits = cc + digits;
    }
    // otherwise assume the country code is already included
  }

  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/** Pretty-print for the admin UI: "+91 98765 43210" for Indian numbers. */
export function formatPhone(digits) {
  if (!digits) return "";
  if (digits.startsWith("91") && digits.length === 12) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}
