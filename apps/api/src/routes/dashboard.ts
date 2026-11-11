import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const querySchema = z.object({
  branchId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  dateBasis: z.enum(["BILL_CREATED", "PAYMENT_CONFIRMED", "SETTLEMENT"]).default("PAYMENT_CONFIRMED"),
});

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/dashboard", { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    const q = querySchema.parse(req.query);
    const dateFrom = q.dateFrom ? new Date(q.dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = q.dateTo ? new Date(q.dateTo) : new Date();

    const billWhere: Record<string, unknown> = {
      orgId: user.orgId,
      ...(q.branchId && { branchId: q.branchId }),
      createdAt: { gte: dateFrom, lte: dateTo },
    };

    const [bills, ledger] = await Promise.all([
      prisma.bill.findMany({ where: billWhere, select: { amountPaise: true, paidPaise: true, status: true } }),
      prisma.ledgerEntry.findMany({
        where: { orgId: user.orgId, postedAt: { gte: dateFrom, lte: dateTo } },
        select: { type: true, amountPaise: true },
      }),
    ]);

    const grossConfirmedPaise = ledger.filter((e) => e.type === "PAYMENT").reduce((s, e) => s + e.amountPaise, 0);
    const refundedPaise = ledger.filter((e) => e.type === "REFUND").reduce((s, e) => s + Math.abs(e.amountPaise), 0);
    const settledPaise = ledger.filter((e) => e.type === "SETTLEMENT").reduce((s, e) => s + Math.abs(e.amountPaise), 0);
    const heldPaise = 0; // computed from settlement holds in phase 4
    const outstandingPaise = bills.filter((b) => b.status !== "CANCELLED").reduce((s, b) => s + (b.amountPaise - b.paidPaise), 0);

    return {
      grossConfirmedPaise,
      outstandingPaise,
      refundedPaise,
      availablePaise: grossConfirmedPaise - refundedPaise - settledPaise - heldPaise,
      heldPaise,
      settledPaise,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      dateBasis: q.dateBasis,
    };
  });
}
