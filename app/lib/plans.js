/**
 * Plans and their limits. A shop's plan is ShopSettings.plan ("free" until billing is added;
 * set it to "pro" in the database to lift limits for a shop by hand).
 * Built-in "Standard" templates (one per stage and language) never count against a limit.
 */
export const PLANS = {
  free: { name: "Free", customTemplates: 5 },
  pro: { name: "Pro", customTemplates: null }, // null = unlimited
};

export function planOf(settings) {
  return PLANS[settings?.plan] ? settings.plan : "free";
}

/** { limit, used, remaining, canCreate } for templates the merchant created themselves. */
export function templateAllowance(plan, used) {
  const limit = (PLANS[plan] || PLANS.free).customTemplates;
  if (limit == null) return { limit: null, used, remaining: null, canCreate: true };
  const remaining = Math.max(0, limit - used);
  return { limit, used, remaining, canCreate: remaining > 0 };
}
