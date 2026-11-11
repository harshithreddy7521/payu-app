import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { UserRole, Err } from "@fee/shared";
import { getPaymentProvider } from "../providers/payment.js";
import { nanoid } from "nanoid";

const refundSchema = z.object({
  billId: z.string(),
  amountPaise: z.number().int().positive(),
  reason: z.string().min(1),
  idempotencyKey: z.string().optional(),
});

export async function refundRoutes(app: FastifyInstance) {
  app.post("/", { preHandler: [requireAuth, requireRoles(UserRole.OWNER, UserRole.FINANCE)] }, async (req, reply) => {
    const user = req.user;
    const body = refundSchema.parse(req.body);
    const idempotencyKey = body.idempotencyKey ?? nanoid();

    // Check idempotency
    const existing = await prisma.refund.findFirst({ where: { idempotencyKey } });
    if (existing) return existing;

    const bill = await prisma.bill.findFirst({ where: { id: body.billId, orgId: user.orgId } });
    if (!bill) throw Err.notFound("Bill");

    // Check cumulative refunds don't exceed paid amount
    const existingRefunds = await prisma.refund.findMany({
      where: { billId: body.billId, status: { in: ["REQUESTED", "SUBMITTED", "SUCCEEDED"] } },
    });
    const alreadyRefunded = existingRefunds.reduce((s, r) => s + r.amountPaise, 0);
    if (alreadyRefunded + body.amountPaise > bill.paidPaise) {
      throw Err.validation("Refund exceeds paid amount");
    }

    const refund = await prisma.refund.create({
      data: {
        billId: body.billId, amountPaise: body.amountPaise, reason: body.reason,
        idempotencyKey, requestedBy: user.sub, status: "REQUESTED",
      },
    });

    await prisma.auditEvent.create({
      data: { orgId: user.orgId, userId: user.sub, action: "REFUND_REQUEST", entity: "Refund", entityId: refund.id },
    });

    return reply.status(201).send(refund);
  });

  app.get("/", { preHandler: [requireAuth, requireRoles(UserRole.OWNER, UserRole.FINANCE)] }, async (req) => {
    const refunds = await prisma.refund.findMany({
      where: { bill: { orgId: req.user.orgId } },
      include: { bill: { select: { purpose: true, amountPaise: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { data: refunds };
  });
}
