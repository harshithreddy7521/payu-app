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
  app.post(
    "/",
    {
      preHandler: [requireAuth, requireRoles(UserRole.OWNER, UserRole.FINANCE)],
    },
    async (req, reply) => {
      const user = req.user;
      const body = refundSchema.parse(req.body);
      const idempotencyKey = String(
        req.headers["idempotency-key"] ?? body.idempotencyKey ?? nanoid(),
      );
      if (!idempotencyKey || idempotencyKey.length > 200)
        throw Err.validation("Invalid idempotency key");

      const refund = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"refund-key:" + idempotencyKey}))`;
        await tx.$queryRaw`SELECT id FROM "Bill" WHERE id=${body.billId} AND "orgId"=${user.orgId} FOR UPDATE`;
        const bill = await tx.bill.findFirst({
          where: { id: body.billId, orgId: user.orgId },
        });
        if (!bill) throw Err.notFound("Bill");
        const existing = await tx.refund.findUnique({
          where: { idempotencyKey },
          include: { bill: { select: { orgId: true } } },
        });
        if (existing) {
          if (
            existing.bill.orgId !== user.orgId ||
            existing.billId !== body.billId ||
            existing.amountPaise !== body.amountPaise ||
            existing.reason !== body.reason
          )
            throw Err.conflict(
              "Refund key already used with different details",
            );
          const { bill: _, ...record } = existing;
          return record;
        }
        const refunds = await tx.refund.aggregate({
          where: {
            billId: body.billId,
            status: { in: ["REQUESTED", "SUBMITTED", "SUCCEEDED"] },
          },
          _sum: { amountPaise: true },
        });
        if ((refunds._sum.amountPaise ?? 0) + body.amountPaise > bill.paidPaise)
          throw Err.validation("Refund exceeds paid amount");
        const record = await tx.refund.create({
          data: {
            billId: body.billId,
            amountPaise: body.amountPaise,
            reason: body.reason,
            idempotencyKey,
            requestedBy: user.sub,
            status: "REQUESTED",
          },
        });
        await tx.auditEvent.create({
          data: {
            orgId: user.orgId,
            userId: user.sub,
            action: "REFUND_REQUEST",
            entity: "Refund",
            entityId: record.id,
          },
        });
        return record;
      });
      return reply.status(201).send(refund);
    },
  );

  app.get(
    "/",
    {
      preHandler: [requireAuth, requireRoles(UserRole.OWNER, UserRole.FINANCE)],
    },
    async (req) => {
      const refunds = await prisma.refund.findMany({
        where: { bill: { orgId: req.user.orgId } },
        include: { bill: { select: { purpose: true, amountPaise: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return { data: refunds };
    },
  );
}
