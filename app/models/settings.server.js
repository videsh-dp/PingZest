import prisma from "../db.server";
import { normalizePhone } from "../lib/phone.js";
import { LOCALES, N_ } from "../i18n/core.js";

export async function getSettings(shop) {
  return prisma.shopSettings.upsert({ where: { shop }, update: {}, create: { shop } });
}

/** Validates form input; returns { settings } or { errors }. */
export async function saveSettings(shop, form) {
  const errors = {};
  const countryCode = String(form.countryCode || "91").replace(/\D/g, "") || "91";
  let whatsappNumber = "";
  if (form.whatsappNumber) {
    whatsappNumber = normalizePhone(form.whatsappNumber, countryCode) || "";
    if (!whatsappNumber) errors.whatsappNumber = N_("Enter a valid WhatsApp number, e.g. 98765 43210 or +91 98765 43210.");
  }
  const defaultLang = form.defaultLang in LOCALES ? form.defaultLang : "en";
  const appLocale = form.appLocale === "auto" || form.appLocale in LOCALES ? form.appLocale : "auto";
  const tag = (v, fallback) => (String(v || "").trim().replace(/,/g, "") || fallback).slice(0, 40);
  const abandonDelayMin = Math.min(Math.max(parseInt(form.abandonDelayMin, 10) || 30, 10), 1440);

  if (Object.keys(errors).length) return { errors };

  const data = {
    storeName: String(form.storeName || "").trim().slice(0, 80),
    whatsappNumber,
    countryCode,
    defaultLang,
    appLocale,
    confirmedTag: tag(form.confirmedTag, "wa-cod-confirmed"),
    cancelledTag: tag(form.cancelledTag, "wa-cod-cancelled"),
    abandonDelayMin,
  };
  // Pro settings are only sent when the shop is on Pro (the fields are disabled otherwise).
  if (form.proSettings) {
    const num = (v, min, max, fallback) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
    };
    Object.assign(data, {
      riskTagHigh: form.riskTagHigh === "on",
      riskTag: tag(form.riskTag, "pingzest-risk-high"),
      prepaidEnabled: form.prepaidEnabled === "on",
      prepaidPercent: num(form.prepaidPercent, 0, 30, 5),
      prepaidMaxAmount: num(form.prepaidMaxAmount, 0, 1_000_000, 0),
      prepaidTag: tag(form.prepaidTag, "pingzest-cod-to-prepaid"),
      addressCheck: form.addressCheck === "on",
    });
  }
  const settings = await prisma.shopSettings.upsert({ where: { shop }, update: data, create: { shop, ...data } });
  return { settings };
}
