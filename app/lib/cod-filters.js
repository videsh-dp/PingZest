/** COD queue tabs: label and database filter (shared by the queue page and the orders model). */
import { N_ } from "../i18n/core.js";

export const COD_FILTERS = {
  todo: { label: N_("To send"), where: { codStatus: "pending" } },
  waiting: { label: N_("Waiting for reply"), where: { codStatus: "sent" } },
  // Waiting longer than the reminder time with no reminder yet (where depends on settings: app/lib/cod-loop.js).
  remind: { label: N_("To remind"), where: { codStatus: "sent" } },
  confirmed: { label: N_("Confirmed"), where: { codStatus: "confirmed" } },
  cancelled: { label: N_("Cancelled"), where: { codStatus: "cancelled" } },
  no_reply: { label: N_("No reply"), where: { codStatus: "no_reply" } },
};

/** The tabs shown side by side; the rest sit under "More" so the tabs never wrap on a phone. */
export const COD_MAIN_TABS = ["todo", "waiting", "remind"];

/** Sort orders for the COD queue. Risk sorting is Pro (risk is only on the rows on Pro). */
export const COD_SORTS = {
  oldest: N_("Oldest first"),
  newest: N_("Newest first"),
  value: N_("Highest value"),
  risk: N_("Highest risk"),
};

const time = (d) => (d ? new Date(d).getTime() : 0);

export function sortCodRows(rows, sort = "oldest") {
  const list = [...rows];
  if (sort === "newest") return list.sort((a, b) => time(b.createdAt) - time(a.createdAt));
  if (sort === "value") return list.sort((a, b) => Number(b.totalPrice || 0) - Number(a.totalPrice || 0) || time(a.createdAt) - time(b.createdAt));
  if (sort === "risk") return list.sort((a, b) => (b.riskScore ?? -1) - (a.riskScore ?? -1) || time(a.createdAt) - time(b.createdAt));
  return list.sort((a, b) => time(a.createdAt) - time(b.createdAt));
}

/** "Send & next": the first row in the list that can be sent and wasn't sent in this run yet. */
export function nextToSend(rows, doneIds = new Set()) {
  return rows.find((r) => r.link && !doneIds.has(r.id)) || null;
}
