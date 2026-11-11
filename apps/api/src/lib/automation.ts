import { prisma } from "./prisma.js";
import { addDays, cycleDate, istInstant, localDate } from "./billing.js";
import { getMessagingProvider } from "../providers/messaging.js";
import { MessageChannel } from "@fee/shared";

// PostgreSQL rows are the durable queue. Transaction locks prevent concurrent runs.
export async function issueBills(orgId: string, now = new Date()) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"billing:" + orgId}))`;
      const today = localDate(now);
      const [year, month] = today.split("-").map(Number);
      const groups = await tx.group.findMany({
        where: { orgId, isActive: true, frequency: "MONTHLY" },
        include: {
          memberships: {
            where: { leftAt: null },
            include: { member: { include: { guardians: true } } },
          },
          reminderPolicies: { where: { isActive: true } },
        },
      });
      let issued = 0;
      for (const group of groups) {
        const date = cycleDate(year, month - 1, group.billDayOfMonth);
        const issueAt = istInstant(date);
        if (
          issueAt > now ||
          (group.endsAt && issueAt > group.endsAt) ||
          group.createdAt > issueAt
        )
          continue;
        for (const membership of group.memberships) {
          if (
            membership.member.status !== "ACTIVE" ||
            membership.joinedAt > issueAt
          )
            continue;
          const period = date.slice(0, 7);
          if (
            await tx.bill.findUnique({
              where: {
                membershipId_billingPeriod: {
                  membershipId: membership.id,
                  billingPeriod: period,
                },
              },
            })
          )
            continue;
          const dueDate = addDays(date, group.dueDayOffset);
          const bill = await tx.bill.create({
            data: {
              orgId,
              branchId: group.branchId,
              groupId: group.id,
              membershipId: membership.id,
              memberId: membership.memberId,
              purpose: `${group.name} · ${period}`,
              amountPaise: membership.amountPaise ?? group.amountPaise,
              dueAt: istInstant(dueDate, "23:59"),
              billingPeriod: period,
              paymentLinks: {
                create: {
                  expiresAt: istInstant(addDays(dueDate, 30), "23:59"),
                },
              },
            },
          });
          for (const policy of group.reminderPolicies)
            for (const guardian of membership.member.guardians) {
              const scheduledAt = istInstant(
                addDays(dueDate, policy.offsetDays),
                policy.sendTimeIST,
              );
              await tx.messageOccurrence.create({
                data: {
                  billId: bill.id,
                  guardianId: guardian.id,
                  channel: policy.channels[0] ?? "WHATSAPP",
                  templateKey: "reminder_before",
                  language: policy.language,
                  scheduledAt,
                  occurrenceKey: `${bill.id}:${guardian.id}:${policy.id}`,
                },
              });
            }
          issued++;
        }
      }
      return { issued };
    },
    { timeout: 30000 },
  );
}

export async function dispatchReminders(now = new Date()) {
  const pending = await prisma.messageOccurrence.findMany({
    where: { status: "QUEUED", scheduledAt: { lte: now } },
    take: 100,
    orderBy: { scheduledAt: "asc" },
  });
  let submitted = 0;
  for (const occurrence of pending) {
    const prepared = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"reminder:" + occurrence.billId}))`;
        const current = await tx.messageOccurrence.findUniqueOrThrow({
          where: { id: occurrence.id },
        });
        if (current.status !== "QUEUED") return;
        const bill = await tx.bill.findUnique({
          where: { id: current.billId },
          include: {
            member: true,
            org: true,
            paymentLinks: {
              include: {
                attempts: {
                  where: {
                    status: "PENDING",
                    createdAt: { gte: new Date(now.getTime() - 10 * 60000) },
                  },
                },
              },
            },
          },
        });
        const guardian = current.guardianId
          ? await tx.guardian.findUnique({ where: { id: current.guardianId } })
          : null;
        const suppress =
          !bill ||
          !["ISSUED", "PARTIAL"].includes(bill.status) ||
          bill.paidPaise >= bill.amountPaise ||
          bill.member?.status !== "ACTIVE" ||
          !guardian ||
          guardian.memberId !== bill.memberId ||
          guardian.optOut ||
          bill.paymentLinks.some((l) => l.status === "REVOKED");
        if (suppress) {
          await tx.messageOccurrence.update({
            where: { id: current.id },
            data: {
              status: "SUPPRESSED",
              failureReason: "Bill or contact is no longer eligible",
            },
          });
          return;
        }
        if (bill!.paymentLinks.some((l) => l.attempts.length)) return;
        // 08:00–20:00 IST quiet hours; no catch-up burst outside the window.
        const hour = new Date(now.getTime() + 330 * 60000).getUTCHours();
        if (hour < 8 || hour >= 20) return;
        const recipients = await tx.guardian.findMany({
          where: { phone: guardian!.phone, member: { orgId: bill!.orgId } },
          select: { id: true },
        });
        const recent = await tx.messageOccurrence.count({
          where: {
            guardianId: { in: recipients.map((g) => g.id) },
            sentAt: { gte: new Date(now.getTime() - 86400_000) },
            status: { in: ["SUBMITTED", "DELIVERED", "UNKNOWN"] },
          },
        });
        if (recent >= 3) return;
        let link = bill!.paymentLinks.find(
          (l) => l.status === "ACTIVE" && l.expiresAt > now,
        );
        const token =
          link?.token ??
          (
            await tx.paymentLink.create({
              data: {
                billId: bill!.id,
                expiresAt: new Date(now.getTime() + 30 * 86400_000),
              },
            })
          ).token;
        // Commit an UNKNOWN claim before contacting the provider. A process restart
        // cannot replay a delivery whose outcome might already have succeeded.
        await tx.messageOccurrence.update({
          where: { id: current.id },
          data: {
            status: "UNKNOWN",
            sentAt: now,
            attempts: { increment: 1 },
            failureReason: "Awaiting provider outcome",
          },
        });
        return { current, bill: bill!, guardian: guardian!, token };
      },
      { timeout: 15000 },
    );
    if (!prepared) continue;
    const { current, bill, guardian, token } = prepared;
    try {
      const result = await getMessagingProvider().send({
        channel: current.channel as MessageChannel,
        to: guardian.phone,
        templateKey: current.templateKey,
        language: current.language,
        variables: {
          amount: ((bill.amountPaise - bill.paidPaise) / 100).toFixed(2),
          merchant: bill.org.name,
          purpose: "your fee",
          dueDate: localDate(bill.dueAt ?? now),
          link: `${process.env.WEB_URL ?? "http://localhost:3000"}/pay/${token}`,
        },
      });
      await prisma.messageOccurrence.update({
        where: { id: current.id },
        data: {
          status: result.status,
          providerRef: result.messageId,
          failureReason: result.error ?? null,
        },
      });
      if (
        result.status === "FAILED" &&
        current.channel === "WHATSAPP" &&
        !current.occurrenceKey.endsWith(":fallback")
      ) {
        const policyId = current.occurrenceKey.split(":").at(-1);
        const policy = policyId
          ? await prisma.reminderPolicy.findUnique({ where: { id: policyId } })
          : null;
        if (policy?.channels.includes("SMS"))
          await prisma.messageOccurrence.upsert({
            where: { occurrenceKey: current.occurrenceKey + ":fallback" },
            create: {
              billId: current.billId,
              guardianId: current.guardianId,
              channel: "SMS",
              language: current.language,
              templateKey: current.templateKey,
              scheduledAt: now,
              occurrenceKey: current.occurrenceKey + ":fallback",
            },
            update: {},
          });
      }
      submitted++;
    } catch {
      await prisma.messageOccurrence.update({
        where: { id: current.id },
        data: {
          status: "UNKNOWN",
          failureReason: "Provider outcome needs review",
        },
      });
    }
  }
  return { submitted };
}
