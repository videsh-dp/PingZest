import prisma from "../db.server";
import { normalizePhone } from "../lib/phone.js";

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
    if (!whatsappNumber) errors.whatsappNumber = "Enter a valid WhatsApp number, e.g. 98765 43210 or +91 98765 43210.";
  }
  const defaultLang = ["en", "hi"].includes(form.defaultLang) ? form.defaultLang : "en";
  const tag = (v, fallback) => (String(v || "").trim().replace(/,/g, "") || fallback).slice(0, 40);
  const abandonDelayMin = Math.min(Math.max(parseInt(form.abandonDelayMin, 10) || 30, 10), 1440);

  if (Object.keys(errors).length) return { errors };

  const data = {
    storeName: String(form.storeName || "").trim().slice(0, 80),
    whatsappNumber,
    countryCode,
    defaultLang,
    confirmedTag: tag(form.confirmedTag, "wa-cod-confirmed"),
    cancelledTag: tag(form.cancelledTag, "wa-cod-cancelled"),
    abandonDelayMin,
  };
  const settings = await prisma.shopSettings.upsert({ where: { shop }, update: data, create: { shop, ...data } });
  return { settings };
}
