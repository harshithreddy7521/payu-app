import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { Err } from "@fee/shared";

const createMemberSchema = z.object({
  name: z.string().min(1),
  externalRef: z.string().optional(),
  customFields: z.record(z.string()).default({}),
  guardians: z.array(z.object({ name: z.string(), phone: z.string(), email: z.string().optional() })).default([]),
});

export async function memberRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    const { cursor, limit = "50", q } = req.query as { cursor?: string; limit?: string; q?: string };
    const members = await prisma.member.findMany({
      where: {
        orgId: user.orgId,
        status: "ACTIVE",
        ...(q && { name: { contains: q, mode: "insensitive" } }),
      },
      include: { guardians: true },
      take: Number(limit),
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: "desc" },
    });
    return { data: members, meta: { cursor: members[members.length - 1]?.id } };
  });

  app.post("/", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    const body = createMemberSchema.parse(req.body);
    if (body.externalRef) {
      const existing = await prisma.member.findUnique({ where: { orgId_externalRef: { orgId: user.orgId, externalRef: body.externalRef } } });
      if (existing) throw Err.conflict("Member with this reference already exists");
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
  });

  app.get("/:id", { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    const member = await prisma.member.findFirst({
      where: { id, orgId: req.user.orgId },
      include: { guardians: true, memberships: { include: { group: true } } },
    });
    if (!member) throw Err.notFound("Member");
    return member;
  });

  app.patch("/:id/archive", { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    const member = await prisma.member.findFirst({ where: { id, orgId: req.user.orgId } });
    if (!member) throw Err.notFound("Member");
    return prisma.member.update({ where: { id }, data: { status: "ARCHIVED" } });
  });
}
