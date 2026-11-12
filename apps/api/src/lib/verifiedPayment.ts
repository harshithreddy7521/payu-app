import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Err } from "@fee/shared";
import { paymentMode } from "../providers/payment.js";
import { prisma } from "./prisma.js";

export const verifiedPaymentSchema = z
  .object({
    amountPaise: z.number().int().positive().max(50_000_000),
    reference: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[A-Z0-9][A-Z0-9-]{5,63}$/,
        "Enter a 6–64 character bank/UPI reference",
      ),
    receivedAt: z.string().datetime({ offset: true }),
    verificationMethod: z.enum(["UPI_APP", "BANK_STATEMENT"]),
    note: z.string().trim().max(500).default(""),
    verified: z.literal(true),
  })
  .strict();

export async function recordVerifiedPayment(
  actor: { sub: string; orgId: string },
  billId: string,
  input: unknown,
) {
  if (paymentMode() !== "manual-upi")
    throw Err.validation(
      "Manual verification is only enabled for direct UPI collection",
    );
  const body = verifiedPaymentSchema.parse(input);
  const receivedAt = new Date(body.receivedAt);
  if (receivedAt.getTime() > Date.now() + 60_000)
    throw Err.validation("Received time cannot be in the future");
  const reference = `manual_upi:${body.reference}`;
  return prisma.$transaction(
    async (tx) => {
      // Recheck current grants, not just potentially stale JWT roles.
      const user = await tx.user.findFirst({
        where: {
          id: actor.sub,
          orgId: actor.orgId,
          isActive: true,
          roleGrants: {
            some: {
              orgId: actor.orgId,
              role: { in: ["OWNER", "FINANCE"] },
              revokedAt: null,
            },
          },
        },
      });
      if (!user)
        throw Err.forbidden(
          "Only an active owner or finance user can verify payments",
        );
      // Serialize this reference globally, and all manual allocations to this bill.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reference}))`;
      await tx.$queryRaw`SELECT id FROM "Bill" WHERE id = ${billId} AND "orgId" = ${actor.orgId} FOR UPDATE`;
      const bill = await tx.bill.findFirst({
        where: { id: billId, orgId: actor.orgId },
      });
      if (!bill) throw Err.notFound("Bill");
      const existing = await tx.payment.findUnique({
        where: { providerRef: reference },
        include: { allocations: true },
      });
      if (existing) {
        const same =
          existing.orgId === actor.orgId &&
          existing.source === "MANUAL_UPI" &&
          existing.amountPaise === body.amountPaise &&
          existing.receivedAt?.getTime() === receivedAt.getTime() &&
          existing.verificationMethod === body.verificationMethod &&
          (existing.verificationNote ?? "") === body.note &&
          existing.allocations.some((a) => a.billId === billId);
        if (!same)
          throw Err.conflict(
            "This bank/UPI reference has already been recorded with different details",
          );
        return {
          paymentId: existing.id,
          receiptNo: existing.receiptNo,
          status: bill.status,
          paidPaise: bill.paidPaise,
          remainingPaise: bill.amountPaise - bill.paidPaise,
          replayed: true,
        };
      }
      if (!["ISSUED", "PARTIAL", "EXPIRED"].includes(bill.status))
        throw Err.validation("This bill cannot receive a payment");
      const remaining = bill.amountPaise - bill.paidPaise;
      if (body.amountPaise > remaining)
        throw Err.validation(
          "Verified amount exceeds the outstanding bill balance",
        );
      const confirmedAt = new Date();
      let link = await tx.paymentLink.findFirst({
        where: { billId },
        orderBy: { createdAt: "desc" },
      });
      if (!link)
        link = await tx.paymentLink.create({
          data: { billId, expiresAt: new Date(Date.now() + 86400_000) },
        });
      // A separate attributed attempt keeps a staff assertion distinct from a provider result.
      const attempt = await tx.paymentAttempt.create({
        data: {
          linkId: link.id,
          providerOrderId: `manual_verified_${randomUUID()}`,
          amountPaise: body.amountPaise,
          status: "SUCCESS",
          confirmedAt,
          providerRef: reference,
        },
      });
      const payment = await tx.payment.create({
        data: {
          attemptId: attempt.id,
          orgId: actor.orgId,
          amountPaise: body.amountPaise,
          providerRef: reference,
          confirmedAt,
          source: "MANUAL_UPI",
          recordedBy: user.id,
          receivedAt,
          verificationMethod: body.verificationMethod,
          verificationNote: body.note,
        },
      });
      await tx.allocation.create({
        data: { billId, paymentId: payment.id, amountPaise: body.amountPaise },
      });
      const newPaid = bill.paidPaise + body.amountPaise;
      const status = newPaid === bill.amountPaise ? "PAID" : "PARTIAL";
      await tx.bill.update({
        where: { id: billId },
        data: { paidPaise: newPaid, status },
      });
      await tx.paymentAttempt.updateMany({
        where: { link: { billId }, status: "PENDING" },
        data: { status: "EXPIRED" },
      });
      if (status === "PAID") {
        await tx.paymentLink.updateMany({
          where: { billId, status: { in: ["ACTIVE", "EXPIRED"] } },
          data: { status: "PAID" },
        });
        await tx.messageOccurrence.updateMany({
          where: { billId, status: "QUEUED" },
          data: {
            status: "SUPPRESSED",
            failureReason: "Bill fully paid; verified by staff",
          },
        });
      }
      await tx.ledgerEntry.create({
        data: {
          orgId: actor.orgId,
          billId,
          type: "PAYMENT",
          source: "MANUAL_UPI",
          amountPaise: body.amountPaise,
          reference: payment.id,
          postedAt: confirmedAt,
        },
      });
      await tx.auditEvent.create({
        data: {
          orgId: actor.orgId,
          userId: user.id,
          action: "PAYMENT_MANUALLY_VERIFIED",
          entity: "Payment",
          entityId: payment.id,
          meta: {
            billId,
            amountPaise: body.amountPaise,
            referenceMasked: `••••${body.reference.slice(-4)}`,
            receivedAt: receivedAt.toISOString(),
            verificationMethod: body.verificationMethod,
            note: body.note,
          },
        },
      });
      return {
        paymentId: payment.id,
        receiptNo: payment.receiptNo,
        status,
        paidPaise: newPaid,
        remainingPaise: bill.amountPaise - newPaid,
        replayed: false,
      };
    },
    { timeout: 15000 },
  );
}
