/**
 * COD → prepaid results. An order counts as converted when the customer opened the payment link on
 * the confirm page and Shopify then reports it paid before it shipped. (A COD order marked paid
 * after delivery, when the cash is collected, doesn't count.)
 */
import prisma from "../db.server";
import { getSettings } from "./settings.server";
import { tagOrder } from "./shopify-admin.server";
import { capture } from "../posthog.server";

export async function recordPaid(shop, payload, admin) {
  const order = await prisma.order.findUnique({ where: { shop_shopifyOrderId: { shop, shopifyOrderId: String(payload.id) } } });
  if (!order || order.paidAt) return null;
  const converted = Boolean(order.isCod && order.prepaidOfferedAt && !order.shippedAt && order.codStatus !== "cancelled");
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      paidAt: new Date(),
      ...(converted
        ? { convertedToPrepaid: true, codStatus: "confirmed", codRespondedAt: order.codRespondedAt || new Date(), codRespondedBy: order.codRespondedBy || "customer" }
        : {}),
    },
  });
  if (converted) {
    const settings = await getSettings(shop);
    if (admin) {
      await tagOrder(admin, order.orderGid, [settings.prepaidTag, settings.confirmedTag].filter(Boolean)).catch((e) => console.error("prepaid tag failed", e?.message));
    }
    capture("cod_converted_to_prepaid", shop, { amount: Number(payload.total_price) || Number(order.totalPrice), currency: order.currency, discount: Number(order.prepaidDiscount || 0) });
  }
  return updated;
}

/** For Analytics: orders switched to prepaid, and the value no longer at risk of returning. */
export async function prepaidStats(shop, days = 30) {
  const since = new Date(Date.now() - days * 86400000);
  const rows = await prisma.order.findMany({
    where: { shop, convertedToPrepaid: true, paidAt: { gte: since } },
    select: { totalPrice: true, currency: true, prepaidDiscount: true },
  });
  const offered = await prisma.order.count({ where: { shop, isCod: true, prepaidOfferedAt: { gte: since } } });
  return {
    converted: rows.length,
    offered,
    value: rows.reduce((s, r) => s + (Number(r.totalPrice) || 0), 0),
    discounts: rows.reduce((s, r) => s + (Number(r.prepaidDiscount) || 0), 0),
    currency: rows[0]?.currency || "INR",
  };
}
