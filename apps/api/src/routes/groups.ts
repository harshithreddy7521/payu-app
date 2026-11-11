import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRoles, branchScope } from "../middleware/auth.js";
import { Err, BillingFrequency, UserRole } from "@fee/shared";
import {
  addDays,
  nextBillDates,
  istInstant,
  localDate,
} from "../lib/billing.js";

const createGroupSchema = z.object({
  branchId: z.string(),
  name: z.string().min(1),
  amountPaise: z.number().int().positive(),
  frequency: z.nativeEnum(BillingFrequency).default(BillingFrequency.MONTHLY),
  billDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  dueDayOffset: z.number().int().min(0).max(90).default(7),
  endsAt: z.string().datetime().optional(),
});

export async function groupRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    const groups = await prisma.group.findMany({
      where: branchScope(user, (req.query as { branchId?: string }).branchId),
      include: { _count: { select: { memberships: true } } },
      orderBy: { createdAt: "desc" },
    });
    return { data: groups };
  });

  app.post(
    "/",
    { preHandler: [requireRoles(UserRole.OWNER, UserRole.BRANCH_MANAGER)] },
    async (req, reply) => {
      const user = req.user;
      const body = createGroupSchema.parse(req.body);
      const branch = await prisma.branch.findFirst({
        where: { id: body.branchId, orgId: user.orgId },
      });
      if (
        !branch ||
        (!user.roles.includes(UserRole.OWNER) &&
          !user.branchIds.includes(branch.id))
      )
        throw Err.notFound("Branch");

      const group = await prisma.group.create({
        data: {
          orgId: user.orgId,
          ...body,
          endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
          reminderPolicies: {
            create: [-3, 0, 3].map((offsetDays) => ({
              offsetDays,
              channels: ["WHATSAPP"],
              sendTimeIST: "10:00",
            })),
          },
        },
      });
      return reply
        .status(201)
        .send({ ...group, nextBillDates: nextBillDates(group, 3) });
    },
  );

  app.get("/:id", { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    const group = await prisma.group.findFirst({
      where: { id, ...branchScope(req.user) },
      include: {
        memberships: { include: { member: true } },
        reminderPolicies: true,
      },
    });
    if (!group) throw Err.notFound("Group");
    return { ...group, nextBillDates: nextBillDates(group, 3) };
  });

  app.post("/preview", { preHandler: [requireAuth] }, async (req) => {
    const body = createGroupSchema.parse(req.body);
    const dates = nextBillDates(
      { ...body, endsAt: body.endsAt ? new Date(body.endsAt) : null },
      3,
    );
    return {
      cycles: dates.map((issueDate) => ({
        issueDate,
        dueDate: addDays(issueDate, body.dueDayOffset),
        amountPaise: body.amountPaise,
        reminders: [-3, 0, 3].map((offset) =>
          addDays(addDays(issueDate, body.dueDayOffset), offset),
        ),
      })),
    };
  });
  app.patch(
    "/:id",
    { preHandler: [requireRoles(UserRole.OWNER, UserRole.BRANCH_MANAGER)] },
    async (req) => {
      const { id } = req.params as { id: string };
      const group = await prisma.group.findFirst({
        where: { id, ...branchScope(req.user) },
      });
      if (!group) throw Err.notFound("Group");
      const body = createGroupSchema
        .omit({ branchId: true })
        .partial()
        .extend({ isActive: z.boolean().optional() })
        .parse(req.body);
      return prisma.group.update({
        where: { id },
        data: {
          ...body,
          endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
        },
      });
    },
  );
  app.put(
    "/:id/reminders",
    { preHandler: [requireRoles(UserRole.OWNER, UserRole.BRANCH_MANAGER)] },
    async (req) => {
      const { id } = req.params as { id: string };
      const group = await prisma.group.findFirst({
        where: { id, ...branchScope(req.user) },
      });
      if (!group) throw Err.notFound("Group");
      const policies = z
        .array(
          z.object({
            offsetDays: z.number().int().min(-30).max(30),
            sendTimeIST: z.string().regex(/^(?:0[89]|1[0-9]):[0-5][0-9]$/),
            channels: z
              .array(z.enum(["WHATSAPP", "SMS"]))
              .min(1)
              .max(2),
            language: z.enum(["en", "hi"]),
          }),
        )
        .max(5)
        .parse(req.body);
      return prisma.$transaction(async (tx) => {
        await tx.reminderPolicy.updateMany({
          where: { groupId: id },
          data: { isActive: false },
        });
        const created = await Promise.all(
          policies.map((p) =>
            tx.reminderPolicy.create({ data: { ...p, groupId: id } }),
          ),
        );
        const bills = await tx.bill.findMany({
          where: { groupId: id, status: { in: ["ISSUED", "PARTIAL"] } },
          include: { member: { include: { guardians: true } } },
        });
        await tx.messageOccurrence.updateMany({
          where: { billId: { in: bills.map((b) => b.id) }, status: "QUEUED" },
          data: {
            status: "SUPPRESSED",
            failureReason: "Reminder policy replaced",
          },
        });
        for (const bill of bills)
          if (bill.dueAt)
            for (const policy of created)
              for (const guardian of bill.member?.guardians ?? []) {
                const scheduledAt = istInstant(
                  addDays(localDate(bill.dueAt), policy.offsetDays),
                  policy.sendTimeIST,
                );
                if (scheduledAt > new Date())
                  await tx.messageOccurrence.create({
                    data: {
                      billId: bill.id,
                      guardianId: guardian.id,
                      channel: policy.channels[0],
                      language: policy.language,
                      templateKey: "reminder_before",
                      scheduledAt,
                      occurrenceKey: `${bill.id}:${guardian.id}:${policy.id}`,
                    },
                  });
              }
        return { saved: policies.length };
      });
    },
  );
  app.delete(
    "/:id/members/:memberId",
    { preHandler: [requireRoles(UserRole.OWNER, UserRole.BRANCH_MANAGER)] },
    async (req) => {
      const { id, memberId } = req.params as { id: string; memberId: string };
      const membership = await prisma.membership.findFirst({
        where: { groupId: id, memberId, orgId: req.user.orgId },
      });
      if (!membership) throw Err.notFound("Membership");
      return prisma.membership.update({
        where: { id: membership.id },
        data: { leftAt: new Date() },
      });
    },
  );

  // Add member to group
  app.post(
    "/:id/members",
    { preHandler: [requireRoles(UserRole.OWNER, UserRole.BRANCH_MANAGER)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { memberId, amountPaise } = z
        .object({
          memberId: z.string(),
          amountPaise: z.number().int().positive().optional(),
        })
        .parse(req.body);
      const [group, member] = await Promise.all([
        prisma.group.findFirst({ where: { id, ...branchScope(req.user) } }),
        prisma.member.findFirst({
          where: { id: memberId, orgId: req.user.orgId },
        }),
      ]);
      if (!group) throw Err.notFound("Group");
      if (!member || member.status !== "ACTIVE")
        throw Err.notFound("Active member");
      if (!group.isActive || (group.endsAt && group.endsAt < new Date()))
        throw Err.validation("Group is inactive or has ended");

      const existing = await prisma.membership.findUnique({
        where: { memberId_groupId: { memberId, groupId: id } },
      });
      if (existing && !existing.leftAt)
        throw Err.conflict("Member already in group");

      const membership = await prisma.membership.upsert({
        where: { memberId_groupId: { memberId, groupId: id } },
        create: { memberId, groupId: id, orgId: req.user.orgId, amountPaise },
        update: {
          leftAt: null,
          joinedAt: new Date(),
          amountPaise: amountPaise ?? null,
        },
      });

      const preview = nextBillDates(group, 3);
      return reply.status(201).send({ membership, preview });
    },
  );
}
