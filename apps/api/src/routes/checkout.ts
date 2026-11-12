import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { manualUpiPayee } from "../providers/manualUpi.js";
import { getPaymentProvider, paymentMode } from "../providers/payment.js";
import { Err } from "@fee/shared";

export async function checkoutRoutes(app: FastifyInstance) {
  // Payer-facing: get bill context from token
  app.get("/:token", async (req) => {
    const { token } = req.params as { token: string };
    const link = await prisma.paymentLink.findUnique({
      where: { token },
      include: { bill: { include: { org: true, branch: true } } },
    });
    if (!link) throw Err.notFound("Payment link");
    if (link.expiresAt < new Date() && link.status === "ACTIVE") {
      await prisma.paymentLink.update({
        where: { id: link.id },
        data: { status: "EXPIRED" },
      });
      link.status = "EXPIRED";
    }
    if (link.status === "REVOKED")
      throw Err.forbidden("Payment link has been revoked");

    return {
      token: link.token,
      paymentMode: paymentMode(),
      payeeVpa: paymentMode() === "manual-upi" ? manualUpiPayee() : undefined,
      merchantName: link.bill.org.name,
      purpose: link.bill.purpose,
      amountPaise: link.bill.amountPaise,
      currency: "INR",
      expiresAt: link.expiresAt.toISOString(),
      status: link.status,
      remainingPaise: link.bill.amountPaise - link.bill.paidPaise,
    };
  });

  app.get("/:token/receipts", async (req) => {
    const { token } = req.params as { token: string };
    const link = await prisma.paymentLink.findUnique({
      where: { token },
      include: {
        bill: {
          include: { org: true, allocations: { include: { payment: true } } },
        },
      },
    });
    if (!link) throw Err.notFound("Payment link");
    return {
      data: link.bill.allocations.map((a) => ({
        receiptNo: a.payment.receiptNo,
        verificationSource: a.payment.source,
        receivedAt: a.payment.receivedAt,
        amountPaise: a.amountPaise,
        confirmedAt: a.payment.confirmedAt,
        merchantName: link.bill.org.name,
        purpose: link.bill.purpose,
        maskedReference: `••••${a.payment.providerRef.slice(-6)}`,
        remainingPaise: link.bill.amountPaise - link.bill.paidPaise,
      })),
    };
  });

  // Start checkout — never accept amount or payee from client
  app.post("/:token/checkout", async (req, reply) => {
    const { token } = req.params as { token: string };
    const body = z.object({ upiApp: z.string().optional() }).parse(req.body);

    const link = await prisma.paymentLink.findUnique({
      where: { token },
      include: {
        bill: { include: { org: true } },
        attempts: { where: { status: "PENDING" }, take: 1 },
      },
    });
    if (!link) throw Err.notFound("Payment link");
    if (link.status !== "ACTIVE")
      throw Err.validation("Payment link is not active");
    if (link.expiresAt < new Date())
      throw Err.validation("Payment link has expired");

    const remaining = link.bill.amountPaise - link.bill.paidPaise;
    if (remaining <= 0) throw Err.validation("Bill is already paid");

    // Reuse a pending attempt if one exists
    if (link.attempts[0]) {
      const existing = link.attempts[0];
      const order = await getPaymentProvider().getOrder(
        existing.providerOrderId,
      );
      if (!order)
        throw Err.conflict(
          "Pending demo order could not be recovered after a server restart. Create a new request.",
        );
      return { ...order, attemptId: existing.id, status: existing.status };
    }

    const provider = getPaymentProvider();
    const order = await provider.createOrder({
      amountPaise: remaining,
      merchantOrderRef: `${link.billId}_${Date.now()}`,
      description: link.bill.purpose,
    });

    const attempt = await prisma.paymentAttempt.create({
      data: {
        linkId: link.id,
        providerOrderId: order.providerOrderId,
        amountPaise: remaining,
        status: "PENDING",
        upiApp: body.upiApp,
      },
    });

    return reply.status(201).send({
      attemptId: attempt.id,
      providerOrderId: order.providerOrderId,
      upiIntentUrl: order.upiIntentUrl,
      qrCodeDataUrl: order.qrCodeDataUrl,
      status: attempt.status,
    });
  });

  // Poll attempt status (app return / browser polling)
  app.get("/:token/attempt/:attemptId", async (req) => {
    const { token, attemptId } = req.params as {
      token: string;
      attemptId: string;
    };
    const link = await prisma.paymentLink.findUnique({
      where: { token },
      include: { bill: { include: { org: true } } },
    });
    if (!link) throw Err.notFound("Payment link");

    const attempt = await prisma.paymentAttempt.findFirst({
      where: { id: attemptId, linkId: link.id },
    });
    if (!attempt) throw Err.notFound("Attempt");

    if (attempt.status === "PENDING") {
      const provider = getPaymentProvider();
      const result = await provider.verifyPayment(attempt.providerOrderId);
      if (result.status === "SUCCESS" && result.providerRef) {
        // Atomic allocation
        await prisma.$transaction(async (tx) => {
          const freshBill = await tx.bill.findUnique({
            where: { id: link.billId },
            select: { amountPaise: true, paidPaise: true, orgId: true },
          });
          if (!freshBill) return;
          const allocate = Math.min(
            result.amountPaise ?? attempt.amountPaise,
            freshBill.amountPaise - freshBill.paidPaise,
          );
          if (allocate <= 0) return;

          const payment = await tx.payment.create({
            data: {
              attemptId: attempt.id,
              orgId: freshBill.orgId,
              amountPaise: allocate,
              providerRef: result.providerRef!,
            },
          });
          await tx.allocation.create({
            data: {
              billId: link.billId,
              paymentId: payment.id,
              amountPaise: allocate,
            },
          });
          const newPaid = freshBill.paidPaise + allocate;
          const newStatus =
            newPaid >= freshBill.amountPaise ? "PAID" : "PARTIAL";
          await tx.bill.update({
            where: { id: link.billId },
            data: { paidPaise: newPaid, status: newStatus },
          });
          if (newStatus === "PAID")
            await tx.paymentLink.update({
              where: { id: link.id },
              data: { status: "PAID" },
            });
          await tx.paymentAttempt.update({
            where: { id: attempt.id },
            data: {
              status: "SUCCESS",
              confirmedAt: new Date(),
              providerRef: result.providerRef,
            },
          });
          await tx.ledgerEntry.create({
            data: {
              orgId: freshBill.orgId,
              billId: link.billId,
              type: "PAYMENT",
              amountPaise: allocate,
              reference: result.providerRef!,
            },
          });
        });
        return {
          status: "SUCCESS",
          providerRef: result.providerRef,
          receiptNo: attempt.id,
        };
      }
      if (result.status === "FAILED") {
        await prisma.paymentAttempt.update({
          where: { id: attempt.id },
          data: { status: "FAILED" },
        });
        return { status: "FAILED" };
      }
    }
    return { status: attempt.status, providerRef: attempt.providerRef };
  });
}
