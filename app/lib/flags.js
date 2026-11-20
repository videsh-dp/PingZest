/**
 * Feature flags. Create a flag with the same key in PostHog (Feature flags → New) to control it per
 * store; release to a % of stores, or target by shop domain or plan. Until a flag exists in PostHog,
 * or when PostHog isn't set up, the default below applies.
 */
export const FLAGS = {
  "google-translate": {
    default: true,
    description: "Show the Google Translate buttons (also needs GOOGLE_TRANSLATE_API_KEY on the server).",
  },
  "widget-languages-tab": {
    default: true,
    description: "Show the Languages tab in the Widgets editor.",
  },
  "template-performance": {
    default: true,
    description: "Show the template performance table in Analytics.",
  },
};

export const FLAG_DEFAULTS = Object.fromEntries(Object.entries(FLAGS).map(([k, f]) => [k, f.default]));

/** Flag value as a boolean ("variant" strings count as on). Unknown flags are off. */
export function isOn(flags, key) {
  const v = flags?.[key] ?? FLAG_DEFAULTS[key];
  return v === true || (typeof v === "string" && v !== "" && v !== "false" && v !== "control");
}
