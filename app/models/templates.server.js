/**
 * Message templates: many per stage and language, one default each.
 * The built-in templates are copied into the shop's list on first use, so everything is editable.
 */
import prisma from "../db.server";
import { DEFAULT_TEMPLATES, TEMPLATE_TYPES, LANGUAGES, validateTemplate } from "../lib/templates.js";
import { prefillWarning } from "../lib/whatsapp.js";
import { N_ } from "../i18n/core.js";
import { getSettings } from "./settings.server";
import { templateAllowance, planOf } from "../lib/plans.js";

export { validateTemplate };

export async function ensureTemplates(shop) {
  // Seeds a "Standard" template for every stage × language that has none yet,
  // so new languages appear for existing shops too.
  const have = await prisma.messageTemplate.findMany({ where: { shop }, select: { type: true, lang: true }, distinct: ["type", "lang"] });
  const seen = new Set(have.map((t) => `${t.type}:${t.lang}`));
  const rows = [];
  for (const type of Object.keys(TEMPLATE_TYPES)) {
    for (const lang of Object.keys(LANGUAGES)) {
      const body = DEFAULT_TEMPLATES[type][lang];
      if (body && !seen.has(`${type}:${lang}`)) rows.push({ shop, type, lang, name: "Standard", body, isDefault: true, seeded: true });
    }
  }
  if (rows.length) await prisma.messageTemplate.createMany({ data: rows });
}

export async function listTemplates(shop) {
  await ensureTemplates(shop);
  return prisma.messageTemplate.findMany({ where: { shop }, orderBy: [{ type: "asc" }, { lang: "asc" }, { isDefault: "desc" }, { createdAt: "asc" }] });
}

async function makeDefault(shop, id, type, lang) {
  await prisma.$transaction([
    prisma.messageTemplate.updateMany({ where: { shop, type, lang }, data: { isDefault: false } }),
    prisma.messageTemplate.updateMany({ where: { shop, id }, data: { isDefault: true } }),
  ]);
}

/** How many custom templates the shop has and may still create on its plan. */
export async function customTemplateAllowance(shop) {
  const [settings, used] = await Promise.all([
    getSettings(shop),
    prisma.messageTemplate.count({ where: { shop, seeded: false } }),
  ]);
  return templateAllowance(planOf(settings), used);
}

const LIMIT_ERROR = N_("The Free plan includes {limit} custom templates. Delete one or upgrade to create more.");

export async function createTemplate(shop, input) {
  const allowance = await customTemplateAllowance(shop);
  if (!allowance.canCreate) return { error: LIMIT_ERROR, errorVars: { limit: allowance.limit }, limitReached: true };
  const data = { type: input.type, lang: input.lang, name: String(input.name || "").trim().slice(0, 60), body: String(input.body || "").trim() };
  const error = validateTemplate(data);
  if (error) return { error };
  const hasAny = await prisma.messageTemplate.count({ where: { shop, type: data.type, lang: data.lang } });
  const t = await prisma.messageTemplate.create({ data: { shop, ...data, isDefault: hasAny === 0 } });
  if (input.isDefault === "true" || input.isDefault === true) await makeDefault(shop, t.id, t.type, t.lang);
  return { ok: true, id: t.id, warning: prefillWarning(data.body) };
}

export async function updateTemplate(shop, id, input) {
  const current = await prisma.messageTemplate.findFirst({ where: { id, shop } });
  if (!current) return { error: N_("Template not found.") };
  const data = { type: current.type, lang: input.lang || current.lang, name: String(input.name ?? current.name).trim().slice(0, 60), body: String(input.body ?? current.body).trim() };
  const error = validateTemplate(data);
  if (error) return { error };
  await prisma.messageTemplate.update({ where: { id }, data: { lang: data.lang, name: data.name, body: data.body } });
  if (data.lang !== current.lang) {
    // moved language: keep exactly one default on both sides
    if (current.isDefault) {
      await prisma.messageTemplate.update({ where: { id }, data: { isDefault: false } });
      const next = await prisma.messageTemplate.findFirst({ where: { shop, type: current.type, lang: current.lang } });
      if (next) await prisma.messageTemplate.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    const others = await prisma.messageTemplate.count({ where: { shop, type: current.type, lang: data.lang, isDefault: true } });
    if (!others) await makeDefault(shop, id, current.type, data.lang);
  }
  return { ok: true, id, warning: prefillWarning(data.body) };
}

export async function duplicateTemplate(shop, id) {
  const t = await prisma.messageTemplate.findFirst({ where: { id, shop } });
  if (!t) return { error: N_("Template not found.") };
  const allowance = await customTemplateAllowance(shop);
  if (!allowance.canCreate) return { error: LIMIT_ERROR, errorVars: { limit: allowance.limit }, limitReached: true };
  const copy = await prisma.messageTemplate.create({
    data: { shop, type: t.type, lang: t.lang, name: `${t.name} (copy)`.slice(0, 60), body: t.body, isDefault: false },
  });
  return { ok: true, id: copy.id };
}

export async function setDefaultTemplate(shop, id) {
  const t = await prisma.messageTemplate.findFirst({ where: { id, shop } });
  if (!t) return { error: N_("Template not found.") };
  await makeDefault(shop, id, t.type, t.lang);
  return { ok: true, id };
}

export async function deleteTemplate(shop, id) {
  const t = await prisma.messageTemplate.findFirst({ where: { id, shop } });
  if (!t) return { error: N_("Template not found.") };
  const siblings = await prisma.messageTemplate.count({ where: { shop, type: t.type, lang: t.lang } });
  if (siblings <= 1) return { error: N_("Keep at least one template for each stage and language. Edit this one instead.") };
  await prisma.messageTemplate.delete({ where: { id } });
  if (t.isDefault) {
    const next = await prisma.messageTemplate.findFirst({ where: { shop, type: t.type, lang: t.lang }, orderBy: { createdAt: "asc" } });
    if (next) await prisma.messageTemplate.update({ where: { id: next.id }, data: { isDefault: true } });
  }
  return { ok: true };
}
