import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRoles, branchScope } from "../middleware/auth.js";
import { Err, UserRole } from "@fee/shared";
import { issueBills } from "../lib/automation.js";
export async function automationRoutes(app: FastifyInstance) {
  app.get("/branches", { preHandler: [requireAuth] }, async (req) => ({
    data: await prisma.branch.findMany({
      where: {
        orgId: req.user.orgId,
        isActive: true,
        ...(!req.user.roles.some((r) => ["OWNER", "FINANCE"].includes(r))
          ? { id: { in: req.user.branchIds } }
          : {}),
      },
      orderBy: { name: "asc" },
    }),
  }));
  app.get(
    "/reminders",
    {
      preHandler: [
        requireRoles(UserRole.OWNER, UserRole.FINANCE, UserRole.BRANCH_MANAGER),
      ],
    },
    async (req) => {
      const bills = await prisma.bill.findMany({
        where: branchScope(
          req.user,
          (req.query as { branchId?: string }).branchId,
        ),
        select: { id: true, purpose: true, amountPaise: true, paidPaise: true },
      });
      const messages = await prisma.messageOccurrence.findMany({
        where: { billId: { in: bills.map((b) => b.id) } },
        orderBy: { scheduledAt: "desc" },
        take: 100,
      });
      return {
        data: messages.map((m) => ({
          ...m,
          bill: bills.find((b) => b.id === m.billId),
        })),
      };
    },
  );
  app.post(
    "/billing/run",
    { preHandler: [requireRoles(UserRole.OWNER)] },
    async (req) => issueBills(req.user.orgId),
  );
  app.post(
    "/reminders/resend",
    { preHandler: [requireRoles(UserRole.OWNER, UserRole.BRANCH_MANAGER)] },
    async (req) => {
      const { occurrenceId } = z
        .object({ occurrenceId: z.string() })
        .parse(req.body);
      const original = await prisma.messageOccurrence.findUnique({
        where: { id: occurrenceId },
      });
      const bill =
        original &&
        (await prisma.bill.findFirst({
          where: { id: original.billId, ...branchScope(req.user) },
        }));
      if (!bill || !original) throw Err.notFound("Reminder");
      if (!["ISSUED", "PARTIAL"].includes(bill.status))
        throw Err.validation("Bill is no longer payable");
      if (["QUEUED", "UNKNOWN"].includes(original.status))
        throw Err.conflict("Resolve the existing delivery before resending");
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"reminder:" + bill.id}))`;
        const pending = await tx.messageOccurrence.findFirst({
          where: {
            billId: bill.id,
            guardianId: original.guardianId,
            status: { in: ["QUEUED", "UNKNOWN"] },
          },
        });
        if (pending) throw Err.conflict("A reminder is already pending");
        const message = await tx.messageOccurrence.create({
          data: {
            billId: bill.id,
            guardianId: original.guardianId,
            channel: original.channel,
            language: original.language,
            templateKey: original.templateKey,
            scheduledAt: new Date(),
            occurrenceKey: `manual:${randomUUID()}`,
          },
        });
        await tx.auditEvent.create({
          data: {
            orgId: req.user.orgId,
            userId: req.user.sub,
            action: "REMINDER_RESEND",
            entity: "MessageOccurrence",
            entityId: message.id,
          },
        });
        return message;
      });
    },
  );
}
