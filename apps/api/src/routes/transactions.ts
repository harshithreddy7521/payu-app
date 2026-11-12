import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, branchScope, requireRoles } from "../middleware/auth.js";

import { UserRole } from "@fee/shared";
import { recordVerifiedPayment } from "../lib/verifiedPayment.js";

const querySchema = z.object({
  cursor: z.string().optional(),
  billId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  branchId: z.string().optional(),
  status: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export async function transactionRoutes(app: FastifyInstance) {
  app.post(
    "/:id/verified-payment",
    { preHandler: [requireRoles(UserRole.OWNER, UserRole.FINANCE)] },
    async (req, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
      const result = await recordVerifiedPayment(req.user, id, req.body);
      return reply.code(result.replayed ? 200 : 201).send(result);
    },
  );

  app.get("/", { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    const q = querySchema.parse(req.query);

    const bills = await prisma.bill.findMany({
      where: {
        ...branchScope(user, q.branchId),
        ...(q.billId ? { id: q.billId } : {}),
        ...(q.status && { status: q.status as never }),
        ...((q.dateFrom || q.dateTo) && {
          createdAt: {
            ...(q.dateFrom && { gte: new Date(q.dateFrom) }),
            ...(q.dateTo && { lte: new Date(q.dateTo) }),
          },
        }),
      },
      include: {
        member: { select: { name: true } },
        branch: { select: { name: true } },
        allocations: { include: { payment: true } },
      },
      take: q.limit,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
      orderBy: { createdAt: "desc" },
    });

    return {
      data: bills.map((b) => ({
        id: b.id,
        branchName: b.branch.name,
        memberName: b.member?.name,
        purpose: b.purpose,
        amountPaise: b.amountPaise,
        paidPaise: b.paidPaise,
        status: b.status,
        createdAt: b.createdAt,
        payments: b.allocations.map((a) => ({
          receiptNo: a.payment.receiptNo,
          amountPaise: a.amountPaise,
          source: a.payment.source,
          referenceMasked: `••••${a.payment.providerRef.slice(-4)}`,
          receivedAt: a.payment.receivedAt,
          confirmedAt: a.payment.confirmedAt,
        })),
      })),
      meta: { cursor: bills[bills.length - 1]?.id },
    };
  });
}
