import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { paymentMode } from "../providers/payment.js";
import { prisma } from "../lib/prisma.js";

// Webhook ingestion: persist first, acknowledge, process async
export async function webhookRoutes(app: FastifyInstance) {
  app.post("/:provider", async (req, reply) => {
    const { provider } = req.params as { provider: string };
    if (paymentMode() !== "fake" || provider !== "fake") return reply.code(403).send({ message: "Demo webhooks are disabled for direct UPI payments" });
    const body = req.body as Record<string, unknown>;

    // Extract provider event ID (fake provider uses body.eventId)
    const eventId = (body.eventId as string) ?? `${provider}_${Date.now()}`;

    // Idempotent: skip already-processed
    const existing = await prisma.providerEvent.findUnique({ where: { provider_eventId: { provider, eventId } } });
    if (existing?.processedAt) return reply.status(200).send({ received: true });

    if (!existing) {
      await prisma.providerEvent.create({ data: { provider, eventId, eventType: (body.eventType as string) ?? "unknown", rawPayload: body as Prisma.InputJsonObject } });
    }

    // Process payment success events inline for now (phase 2: move to worker queue)
    if (body.eventType === "payment.captured" && body.providerOrderId && body.providerRef) {
      const attempt = await prisma.paymentAttempt.findFirst({
        where: { providerOrderId: body.providerOrderId as string, status: "PENDING" },
        include: { link: { include: { bill: true } } },
      });
      if (attempt && attempt.status === "PENDING") {
        const amountPaise = (body.amountPaise as number) ?? attempt.amountPaise;
        const remaining = attempt.link.bill.amountPaise - attempt.link.bill.paidPaise;
        const allocate = Math.min(amountPaise, remaining);
        if (allocate > 0) {
          await prisma.$transaction(async (tx) => {
            const payment = await tx.payment.create({
              data: { attemptId: attempt.id, orgId: attempt.link.bill.orgId, amountPaise: allocate, providerRef: body.providerRef as string },
            });
            await tx.allocation.create({ data: { billId: attempt.link.billId, paymentId: payment.id, amountPaise: allocate } });
            const newPaid = attempt.link.bill.paidPaise + allocate;
            const newStatus = newPaid >= attempt.link.bill.amountPaise ? "PAID" : "PARTIAL";
            await tx.bill.update({ where: { id: attempt.link.billId }, data: { paidPaise: newPaid, status: newStatus } });
            if (newStatus === "PAID") await tx.paymentLink.update({ where: { id: attempt.linkId }, data: { status: "PAID" } });
            await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "SUCCESS", confirmedAt: new Date(), providerRef: body.providerRef as string } });
            await tx.ledgerEntry.create({
              data: { orgId: attempt.link.bill.orgId, billId: attempt.link.billId, type: "PAYMENT", amountPaise: allocate, reference: body.providerRef as string },
            });
          });
        }
      }
      await prisma.providerEvent.update({ where: { provider_eventId: { provider, eventId } }, data: { processedAt: new Date() } });
    }

    return reply.status(200).send({ received: true });
  });
}
