import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { UserRole, Err } from "@fee/shared";

export async function settlementRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: [requireAuth, requireRoles(UserRole.OWNER, UserRole.FINANCE)] }, async (req) => {
    const batches = await prisma.settlementBatch.findMany({
      where: { orgId: req.user.orgId },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return { data: batches };
  });

  app.get("/:id", { preHandler: [requireAuth, requireRoles(UserRole.OWNER, UserRole.FINANCE)] }, async (req) => {
    const { id } = req.params as { id: string };
    const batch = await prisma.settlementBatch.findFirst({
      where: { id, orgId: req.user.orgId },
      include: { items: { include: { destination: true } } },
    });
    if (!batch) throw Err.notFound("Settlement batch");
    return batch;
  });
}
