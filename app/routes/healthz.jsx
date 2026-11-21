import prisma from "../db.server";

// Health check for deploys and uptime monitors: 200 when the app and MongoDB answer.
export const loader = async () => {
  try {
    await prisma.$runCommandRaw({ ping: 1 });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, db: "unreachable" }, { status: 503 });
  }
};
