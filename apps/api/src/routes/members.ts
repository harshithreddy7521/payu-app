import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
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
  app.get("/", { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    const {
      cursor,
      limit = "50",
      q,
    } = req.query as { cursor?: string; limit?: string; q?: string };
    const members = await prisma.member.findMany({
      where: {
        orgId: user.orgId,
        status: "ACTIVE",
        ...(q && { name: { contains: q, mode: "insensitive" } }),
      },
      include: { guardians: true },
      take: Math.max(1, Math.min(100, Number(limit) || 50)),
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: "desc" },
    });
    return { data: members, meta: { cursor: members[members.length - 1]?.id } };
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
