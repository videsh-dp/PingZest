import { N_ } from "../i18n/core.js";
/** Discount form validation (pure, unit-tested). */

/** Validate form input. Returns { data } or { errors }. */
export function parseDiscountForm(form, now = new Date()) {
  const errors = {};
  const code = String(form.code || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) errors.code = N_("Use 3–30 letters, numbers, - or _ (e.g. WELCOME10).");
  const kind = form.kind === "fixed" ? "fixed" : "percentage";
  const value = Number(form.value);
  if (!Number.isFinite(value) || value <= 0) errors.value = N_("Enter an amount above 0.");
  else if (kind === "percentage" && value > 100) errors.value = N_("A percentage can't be more than 100.");
  const minSubtotal = form.minSubtotal ? Number(form.minSubtotal) : null;
  if (minSubtotal !== null && (!Number.isFinite(minSubtotal) || minSubtotal < 0)) errors.minSubtotal = N_("Enter a valid amount or leave empty.");
  let endsAt = null;
  if (form.endsAt) {
    endsAt = new Date(`${form.endsAt}T23:59:59`);
    if (Number.isNaN(endsAt.getTime()) || endsAt <= now) errors.endsAt = N_("Pick a date in the future, or leave empty.");
  }
  if (Object.keys(errors).length) return { errors };
  const title = String(form.title || "").trim().slice(0, 80) || `${code} (WA Assist banner)`;
  return {
    data: {
      code, title, kind, value, minSubtotal, endsAt,
      oncePerCustomer: form.oncePerCustomer === "on" || form.oncePerCustomer === "true",
    },
  };
}

/** "10% off" / "₹200 off" */
export function describeDiscount(d, currency = "INR") {
  if (d.kind === "percentage") return `${d.value}% off`;
  try {
    return `${new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(d.value)} off`;
  } catch {
    return `${d.value} off`;
  }
}
