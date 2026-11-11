import type { FastifyReply, FastifyRequest } from "fastify";
import { UserRole } from "@fee/shared";
import { Err } from "@fee/shared";

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    throw Err.unauthorized();
  }
}

export function requireRoles(...roles: UserRole[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    await requireAuth(req, _reply);
    const user = req.user as { roles: UserRole[] };
    const hasRole = roles.some((r) => user.roles.includes(r));
    if (!hasRole) throw Err.forbidden();
  };
}

// Inject orgId guard — ensures route params orgId matches JWT claim
export async function requireOrgScope(req: FastifyRequest, _reply: FastifyReply) {
  const user = req.user as { orgId: string };
  const params = req.params as { orgId?: string };
  if (params.orgId && params.orgId !== user.orgId) throw Err.forbidden("Cross-tenant access denied");
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    user: {
      sub: string;
      orgId: string;
      roles: UserRole[];
      branchIds: string[];
    };
  }
}
