import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRoles, branchScope } from "../middleware/auth.js";
import { memberCsv } from "../lib/csv.js";
import { Err, UserRole } from "@fee/shared";

const createMemberSchema = z.object({
  name: z.string().trim().min(1).max(120),
  externalRef: z.string().optional(),
  customFields: z.record(z.string()).default({}),
  guardians: z
    .array(
      z.object({
        name: z.string(),
        phone: z.string(),
        email: z.string().optional(),
      }),
    )
    .default([]),
});

export async function memberRoutes(app: FastifyInstance) {
  app.put(
    "/:id/guardians/:guardianId/whatsapp-consent",
    { preHandler: [requireRoles(UserRole.OWNER)] },
    async (req) => {
      const { id, guardianId } = req.params as {
        id: string;
        guardianId: string;
      };
      const body = z
        .object({
          optIn: z.boolean(),
          evidence: z.string().trim().min(5).max(500),
        })
        .parse(req.body);
      const guardian = await prisma.guardian.findFirst({
        where: {
          id: guardianId,
          memberId: id,
          member: { orgId: req.user.orgId },
        },
      });
      if (!guardian) throw Err.notFound("Guardian");
      return prisma.$transaction(async (tx) => {
        const contact = await tx.guardian.update({
          where: { id: guardianId },
          data: {
            optOut: !body.optIn,
            whatsappConsentedAt: body.optIn ? new Date() : null,
            consentEvidence: body.evidence,
          },
        });
        await tx.auditEvent.create({
          data: {
            orgId: req.user.orgId,
            userId: req.user.sub,
            action: body.optIn ? "WHATSAPP_OPT_IN" : "WHATSAPP_OPT_OUT",
            entity: "Guardian",
            entityId: guardianId,
            meta: { evidence: body.evidence },
          },
        });
        if (!body.optIn)
          await tx.messageOccurrence.updateMany({
            where: { guardianId, status: "QUEUED" },
            data: { status: "SUPPRESSED", failureReason: "Contact opted out" },
          });
        return contact;
      });
    },
  );
  app.get("/", { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    const {
      cursor,
      limit = "50",
      q,
      lookup,
    } = req.query as {
      cursor?: string;
      limit?: string;
      q?: string;
      lookup?: string;
    };
    const members = await prisma.member.findMany({
      where: {
        orgId: user.orgId,
        status: "ACTIVE",
        ...(q && {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { externalRef: { contains: q, mode: "insensitive" } },
            { guardians: { some: { phone: { contains: q } } } },
          ],
        }),
      },
      include: { guardians: true },
      take: Math.max(1, Math.min(100, Number(limit) || 50)),
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: "desc" },
    });
    if (lookup === "1")
      return {
        data: members.map(({ id, name, externalRef }) => ({
          id,
          name,
          externalRef,
        })),
      };
    const grouped = await prisma.bill.groupBy({
      by: ["memberId", "status"],
      where: {
        ...branchScope(user),
        memberId: { in: members.map((member) => member.id) },
      },
      _sum: { amountPaise: true, paidPaise: true },
    });
    const totals = new Map<
      string,
      { paidPaise: number; duePaise: number; remainingPaise: number }
    >();
    for (const row of grouped) {
      if (!row.memberId) continue;
      const total = totals.get(row.memberId) ?? {
        paidPaise: 0,
        duePaise: 0,
        remainingPaise: 0,
      };
      const paid = row._sum.paidPaise ?? 0;
      total.paidPaise += paid;
      if (["ISSUED", "PARTIAL", "EXPIRED"].includes(row.status)) {
        const due = Math.max(0, (row._sum.amountPaise ?? 0) - paid);
        total.duePaise += due;
        total.remainingPaise += due;
      }
      totals.set(row.memberId, total);
    }
    return {
      data: members.map((member) => ({
        ...member,
        totals: totals.get(member.id) ?? {
          paidPaise: 0,
          duePaise: 0,
          remainingPaise: 0,
        },
      })),
      meta: { cursor: members[members.length - 1]?.id },
    };
  });

  app.get("/:id/balance", { preHandler: [requireAuth] }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const member = await prisma.member.findFirst({
      where: { id, orgId: req.user.orgId },
      select: { id: true, name: true },
    });
    if (!member) throw Err.notFound("Member");
    const bills = await prisma.bill.findMany({
      where: { ...branchScope(req.user), memberId: id },
      select: {
        id: true,
        amountPaise: true,
        paidPaise: true,
        purpose: true,
        status: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const totals = bills.reduce(
      (total, bill) => {
        total.paidPaise += bill.paidPaise;
        if (["ISSUED", "PARTIAL", "EXPIRED"].includes(bill.status)) {
          total.duePaise += Math.max(0, bill.amountPaise - bill.paidPaise);
          total.remainingPaise = total.duePaise;
        }
        return total;
      },
      { paidPaise: 0, duePaise: 0, remainingPaise: 0 },
    );
    return { name: member.name, totals, bills };
  });
  app.post(
    "/",
    { preHandler: [requireRoles(UserRole.OWNER, UserRole.BRANCH_MANAGER)] },
    async (req, reply) => {
      const user = req.user;
      const body = createMemberSchema.parse(req.body);
      if (body.externalRef) {
        const existing = await prisma.member.findUnique({
          where: {
            orgId_externalRef: {
              orgId: user.orgId,
              externalRef: body.externalRef,
            },
          },
        });
        if (existing)
          throw Err.conflict("Member with this reference already exists");
      }
      const member = await prisma.member.create({
        data: {
          orgId: user.orgId,
          name: body.name,
          externalRef: body.externalRef,
          customFields: body.customFields,
          guardians: { create: body.guardians },
        },
        include: { guardians: true },
      });
      return reply.status(201).send(member);
    },
  );

  app.post(
    "/import",
    { preHandler: [requireRoles(UserRole.OWNER, UserRole.BRANCH_MANAGER)] },
    async (req) => {
      const body = z
        .object({
          csv: z.string().max(500000),
          confirm: z.boolean().default(false),
        })
        .parse(req.body);
      let rows;
      try {
        rows = memberCsv(body.csv);
      } catch (e) {
        throw Err.validation((e as Error).message);
      }
      const existing = await prisma.member.findMany({
        where: {
          orgId: req.user.orgId,
          externalRef: { in: rows.map((r) => r.externalRef) },
        },
        select: { externalRef: true },
      });
      const refs = new Set(existing.map((m) => m.externalRef));
      for (const row of rows)
        if (refs.has(row.externalRef))
          row.errors.push("Reference already exists in this organisation");
      if (!body.confirm)
        return {
          rows,
          valid: rows.filter((r) => !r.errors.length).length,
          imported: 0,
        };
      if (rows.some((r) => r.errors.length))
        throw Err.validation("Resolve row errors before importing", { rows });
      await prisma.$transaction(async (tx) => {
        for (const row of rows)
          await tx.member.create({
            data: {
              orgId: req.user.orgId,
              name: row.name,
              externalRef: row.externalRef,
              guardians: {
                create: row.phone
                  ? [{ name: row.guardianName, phone: row.phone }]
                  : [],
              },
            },
          });
        await tx.auditEvent.create({
          data: {
            orgId: req.user.orgId,
            userId: req.user.sub,
            action: "MEMBER_IMPORT",
            entity: "Member",
            meta: { count: rows.length },
          },
        });
      });
      return { rows, valid: rows.length, imported: rows.length };
    },
  );

  app.get("/:id", { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    const member = await prisma.member.findFirst({
      where: { id, orgId: req.user.orgId },
      include: { guardians: true, memberships: { include: { group: true } } },
    });
    if (!member) throw Err.notFound("Member");
    return member;
  });

  app.patch(
    "/:id/archive",
    { preHandler: [requireRoles(UserRole.OWNER, UserRole.BRANCH_MANAGER)] },
    async (req) => {
      const { id } = req.params as { id: string };
      const member = await prisma.member.findFirst({
        where: { id, orgId: req.user.orgId },
      });
      if (!member) throw Err.notFound("Member");
      return prisma.member.update({
        where: { id },
        data: { status: "ARCHIVED" },
      });
    },
  );
}
