import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { once } from "../lib/requestResult.js";
import { requireRoles } from "../middleware/auth.js";
import { Err, UserRole } from "@fee/shared";
export async function financeReviewRoutes(app: FastifyInstance) {
  const finance = requireRoles(UserRole.OWNER, UserRole.FINANCE);
  app.get("/destinations", { preHandler: [finance] }, async (req) => ({
    data: await prisma.destinationChange.findMany({
      where: { orgId: req.user.orgId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  }));
  app.post(
    "/destinations",
    { preHandler: [requireRoles(UserRole.OWNER)] },
    async (req) => {
      const body = z
        .object({
          lastFour: z.string().regex(/^\d{4}$/),
          ifsc: z
            .string()
            .trim()
            .toUpperCase()
            .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
        })
        .strict()
        .parse(req.body);
      return prisma.$transaction((tx) =>
        once(
          tx,
          req.user.orgId,
          "destination-review",
          String(req.headers["idempotency-key"] ?? randomUUID()),
          body,
          async () => {
            const change = await tx.destinationChange.create({
              data: {
                orgId: req.user.orgId,
                maskedValue: "••••" + body.lastFour,
                ifsc: body.ifsc,
                requestedBy: req.user.sub,
              },
            });
            await tx.auditEvent.create({
              data: {
                orgId: req.user.orgId,
                userId: req.user.sub,
                action: "DESTINATION_REVIEW_REQUEST",
                entity: "DestinationChange",
                entityId: change.id,
              },
            });
            return change;
          },
        ),
      );
    },
  );
  app.post(
    "/destinations/:id/approve",
    { preHandler: [finance] },
    async (req) => {
      const { id } = req.params as { id: string };
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "DestinationChange" WHERE id=${id} AND "orgId"=${req.user.orgId} FOR UPDATE`;
        const change = await tx.destinationChange.findFirst({
          where: { id, orgId: req.user.orgId },
        });
        if (!change) throw Err.notFound("Destination request");
        if (change.requestedBy === req.user.sub)
          throw Err.forbidden(
            "A different authorised person must review this request",
          );
        if (change.status === "APPROVED_PENDING_VERIFICATION") return change;
        if (change.status !== "REQUESTED")
          throw Err.conflict("Request already reviewed");
        const result = await tx.destinationChange.update({
          where: { id },
          data: {
            status: "APPROVED_PENDING_VERIFICATION",
            reviewedBy: req.user.sub,
            reviewedAt: new Date(),
          },
        });
        await tx.auditEvent.create({
          data: {
            orgId: req.user.orgId,
            userId: req.user.sub,
            action: "DESTINATION_REVIEW_APPROVED",
            entity: "DestinationChange",
            entityId: id,
          },
        });
        return result;
      });
    },
  );
  app.post("/refunds/:id/approve", { preHandler: [finance] }, async (req) => {
    const { id } = req.params as { id: string };
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Refund" WHERE id=${id} FOR UPDATE`;
      const refund = await tx.refund.findFirst({
        where: { id, bill: { orgId: req.user.orgId } },
      });
      if (!refund) throw Err.notFound("Refund");
      if (refund.requestedBy === req.user.sub)
        throw Err.forbidden(
          "A different authorised person must approve refunds",
        );
      if (refund.status !== "REQUESTED")
        throw Err.conflict("Refund is no longer awaiting approval");
      if (refund.approvedBy) return refund;
      const result = await tx.refund.update({
        where: { id },
        data: { approvedBy: req.user.sub },
      });
      await tx.auditEvent.create({
        data: {
          orgId: req.user.orgId,
          userId: req.user.sub,
          action: "REFUND_REVIEW_APPROVED",
          entity: "Refund",
          entityId: id,
        },
      });
      // Approval is not a provider submission and must not claim money was sent.
      return result;
    });
  });
  app.get("/operations", { preHandler: [finance] }, async (req) => {
    const [destinations, refunds, unknownMessages] = await Promise.all([
      prisma.destinationChange.count({
        where: {
          orgId: req.user.orgId,
          status: { in: ["REQUESTED", "APPROVED_PENDING_VERIFICATION"] },
        },
      }),
      prisma.refund.count({
        where: { bill: { orgId: req.user.orgId }, status: "REQUESTED" },
      }),
      prisma.messageOccurrence.count({
        where: {
          status: "UNKNOWN",
          billId: {
            in: (
              await prisma.bill.findMany({
                where: { orgId: req.user.orgId },
                select: { id: true },
              })
            ).map((b) => b.id),
          },
        },
      }),
    ]);
    return {
      destinationsAwaitingVerification: destinations,
      refundsAwaitingExecution: refunds,
      unknownMessages,
      notificationSendingEnabled: process.env.NOTIFICATIONS_ENABLED === "true",
      payoutExecutionEnabled: false,
    };
  });
}
