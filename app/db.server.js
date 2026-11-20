import { PrismaClient } from "@prisma/client";

// Reuse one client in development (Vite reloads modules on every change).
const prisma = globalThis.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalThis.__prisma = prisma;

export default prisma;
