/**
 * POST /cron/cod: runs the COD autopilot (Pro: expire unanswered orders, opt-in cancel + restock) for every
 * shop that turned it on. The same work also runs on COD webhooks and app loads, so this endpoint is only
 * needed to keep quiet stores on time. Call it from any scheduler (cron, GitHub Actions, an uptime monitor):
 *
 *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-app/cron/cod
 *
 * Off (404) until CRON_SECRET is set. Answers with counts only (no shop or customer data).
 */
import { timingSafeEqual } from "node:crypto";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { processDueCod } from "../models/cod-loop.server";

function authorized(request) {
  const secret = process.env.CRON_SECRET || "";
  if (secret.length < 16) return null; // not configured
  const given = Buffer.from((request.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

export const loader = () => new Response(null, { status: 405, headers: { Allow: "POST" } });

export const action = async ({ request }) => {
  const ok = authorized(request);
  if (ok === null) return new Response("Not found", { status: 404 });
  if (!ok) return new Response("Unauthorized", { status: 401 });

  const shops = await prisma.shopSettings.findMany({ where: { plan: "pro", codAutoExpire: true }, select: { shop: true } });
  let expired = 0;
  let failed = 0;
  for (const { shop } of shops) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      expired += (await processDueCod(shop, admin, { throttle: false })).expired || 0;
    } catch (e) {
      failed += 1;
      console.error("cron/cod failed for a shop", e?.message);
    }
  }
  return Response.json({ shops: shops.length, expired, failed }, { headers: { "Cache-Control": "no-store" } });
};
