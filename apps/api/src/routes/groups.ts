import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { Err, BillingFrequency } from "@fee/shared";
import { nextBillDates } from "../lib/billing.js";

const createGroupSchema = z.object({
  branchId: z.string(),
  name: z.string().min(1),
  amountPaise: z.number().int().positive(),
  frequency: z.nativeEnum(BillingFrequency).default(BillingFrequency.MONTHLY),
  billDayOfMonth: z.number().int().min(1).max(31).optional(),
  dueDayOffset: z.number().int().default(7),
  endsAt: z.string().datetime().optional(),
});

export async function groupRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    const groups = await prisma.group.findMany({
      where: { orgId: user.orgId },
      include: { _count: { select: { memberships: true } } },
      orderBy: { createdAt: "desc" },
    });
    return { data: groups };
  });

  app.post("/", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    const body = createGroupSchema.parse(req.body);
    const branch = await prisma.branch.findFirst({ where: { id: body.branchId, orgId: user.orgId } });
    if (!branch) throw Err.notFound("Branch");

    const group = await prisma.group.create({
      data: { orgId: user.orgId, ...body, endsAt: body.endsAt ? new Date(body.endsAt) : undefined },
    });
    return reply.status(201).send({ ...group, nextBillDates: nextBillDates(group, 3) });
  });

  app.get("/:id", { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    const group = await prisma.group.findFirst({
      where: { id, orgId: req.user.orgId },
      include: { memberships: { include: { member: true } }, reminderPolicies: true },
    });
    if (!group) throw Err.notFound("Group");
    return { ...group, nextBillDates: nextBillDates(group, 3) };
  });

  // Add member to group
  app.post("/:id/members", { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { memberId, amountPaise } = z.object({ memberId: z.string(), amountPaise: z.number().optional() }).parse(req.body);
    const [group, member] = await Promise.all([
      prisma.group.findFirst({ where: { id, orgId: req.user.orgId } }),
      prisma.member.findFirst({ where: { id: memberId, orgId: req.user.orgId } }),
    ]);
    if (!group) throw Err.notFound("Group");
    if (!member) throw Err.notFound("Member");

    const existing = await prisma.membership.findUnique({ where: { memberId_groupId: { memberId, groupId: id } } });
    if (existing && !existing.leftAt) throw Err.conflict("Member already in group");

    const membership = await prisma.membership.create({
      data: { memberId, groupId: id, orgId: req.user.orgId, amountPaise },
    });

    const preview = nextBillDates(group, 3);
    return reply.status(201).send({ membership, preview });
  });
}
