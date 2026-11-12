import { prisma } from "./prisma.js";
import { getMessagingProvider } from "../providers/messaging.js";
import { MessageChannel } from "@fee/shared";
export async function dispatchQuickPay() {
  const jobs = await prisma.outboxEvent.findMany({
    where: { eventType: "QUICK_PAY_WHATSAPP", processedAt: null },
    take: 50,
    orderBy: { createdAt: "asc" },
  });
  for (const job of jobs) {
    const claim = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${job.id}))`;
      const row = await tx.outboxEvent.findUniqueOrThrow({
        where: { id: job.id },
      });
      if (row.processedAt) return null;
      const data = row.payload as {
        orgId: string;
        billId: string;
        phone: string;
        consentedAt: string;
        merchant: string;
        link: string;
      };
      const bill = await tx.bill.findFirst({
        where: { id: data.billId, orgId: data.orgId },
        include: { member: { include: { guardians: true } } },
      });
      const suppress =
        !bill ||
        !["ISSUED", "PARTIAL"].includes(bill.status) ||
        bill.paidPaise >= bill.amountPaise ||
        !data.consentedAt ||
        bill.member?.guardians.some((g) => g.phone === data.phone && g.optOut);
      await tx.outboxEvent.update({
        where: { id: job.id },
        data: {
          processedAt: new Date(),
          payload: { ...data, status: suppress ? "SUPPRESSED" : "UNKNOWN" },
        },
      });
      return suppress ? null : { data, bill: bill! };
    });
    if (!claim) continue;
    try {
      const result = await getMessagingProvider().send({
        channel: MessageChannel.WHATSAPP,
        to: claim.data.phone,
        templateKey: "payment_request",
        variables: {
          amount: (
            (claim.bill.amountPaise - claim.bill.paidPaise) /
            100
          ).toFixed(2),
          merchant: claim.data.merchant,
          purpose: "your payment request",
          link: claim.data.link,
        },
      });
      await prisma.outboxEvent.update({
        where: { id: job.id },
        data: {
          payload: {
            ...claim.data,
            status: result.status,
            providerRef: result.messageId,
          },
        },
      });
    } catch {
      /* UNKNOWN requires recovery, never blindly resend. */
    }
  }
}
