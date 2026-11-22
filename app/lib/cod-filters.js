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
