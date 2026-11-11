import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Err } from "@fee/shared";
import { requireAuth } from "../middleware/auth.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: body.email },
      include: {
        roleGrants: { where: { revokedAt: null } },
        org: true,
      },
    });
    if (!user || !user.isActive) throw Err.unauthorized();
    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) throw Err.unauthorized();

    const roles = [...new Set(user.roleGrants.map((g) => g.role))];
    const branchIds = user.roleGrants.filter((g) => g.branchId).map((g) => g.branchId!);

    const token = app.jwt.sign(
      { sub: user.id, orgId: user.orgId, roles, branchIds },
      { expiresIn: "8h" },
    );

    await prisma.auditEvent.create({
      data: { orgId: user.orgId, userId: user.id, action: "LOGIN", entity: "User", entityId: user.id, ipAddress: req.ip },
    });

    return reply.send({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles,
        orgId: user.orgId,
        orgName: user.org.name,
        profile: user.org.profile,
        branchIds,
      },
    });
  });

  app.get("/me", { preHandler: [requireAuth] }, async (req) => {
    const user = req.user;
    return { sub: user.sub, orgId: user.orgId, roles: user.roles, branchIds: user.branchIds };
  });
}
