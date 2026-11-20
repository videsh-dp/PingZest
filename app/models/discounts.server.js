/**
 * Discount codes created from the app. Shopify is the source of truth for whether a code works;
 * we keep a copy for the list, the banner picker and analytics.
 */
import prisma from "../db.server";
import { createCodeDiscount, setDiscountActive, deleteCodeDiscount } from "./shopify-admin.server";
import { parseDiscountForm } from "../lib/discounts.js";
import { N_ } from "../i18n/core.js";

export { parseDiscountForm };

export async function listDiscounts(shop) {
  return prisma.discount.findMany({ where: { shop }, orderBy: { createdAt: "desc" } });
}

export async function createDiscount(shop, admin, form) {
  const parsed = parseDiscountForm(form);
  if (parsed.errors) return parsed;
  const exists = await prisma.discount.findUnique({ where: { shop_code: { shop, code: parsed.data.code } } });
  if (exists) return { errors: { code: N_("You already created this code.") } };
  const result = await createCodeDiscount(admin, parsed.data);
  if (result.error) return { errors: { form: `Shopify: ${result.error}` } };
  const discount = await prisma.discount.create({ data: { shop, shopifyGid: result.gid, ...parsed.data } });
  return { discount };
}

export async function toggleDiscount(shop, admin, id, active) {
  const d = await prisma.discount.findFirst({ where: { id, shop } });
  if (!d) return { error: "Not found" };
  if (d.shopifyGid) {
    const r = await setDiscountActive(admin, d.shopifyGid, active);
    if (r.error) return r;
  }
  await prisma.discount.update({ where: { id }, data: { active } });
  return { ok: true };
}

export async function removeDiscount(shop, admin, id) {
  const d = await prisma.discount.findFirst({ where: { id, shop } });
  if (!d) return { error: "Not found" };
  if (d.shopifyGid) {
    const r = await deleteCodeDiscount(admin, d.shopifyGid);
    // Already deleted in Shopify admin? Still remove our copy.
    if (r.error && !/not exist|not found/i.test(r.error)) return r;
  }
  await prisma.discount.delete({ where: { id } });
  return { ok: true };
}
