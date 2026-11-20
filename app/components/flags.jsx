/**
 * Feature flags in the admin UI. Values come from PostHog on the server (app.jsx loader), so the
 * page renders with the right features straight away, with no flicker.
 *   const showX = useFlag("my-flag");
 */
import { createContext, useContext } from "react";
import { FLAG_DEFAULTS, isOn } from "../lib/flags.js";

const FlagsContext = createContext(FLAG_DEFAULTS);

export function FlagsProvider({ flags, children }) {
  return <FlagsContext.Provider value={flags || FLAG_DEFAULTS}>{children}</FlagsContext.Provider>;
}

export function useFlag(key) {
  return isOn(useContext(FlagsContext), key);
}

/** Variant value for multivariate flags ("control", "test"…), or the boolean. */
export function useFlagValue(key) {
  const flags = useContext(FlagsContext);
  return flags?.[key] ?? FLAG_DEFAULTS[key];
}
