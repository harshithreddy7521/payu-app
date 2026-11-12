import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { once } from "../lib/requestResult.js";
import { requireRoles, branchScope } from "../middleware/auth.js";
import { Err, UserRole } from "@fee/shared";
const schema = z.object({
  amountPaise: z.number().int().positive().max(50_000_000),
  branchId: z.string(),
  purpose: z.string().trim().min(1).max(200),
  memberId: z.string().optional(),
  recipientName: z.string().optional(),
  recipientPhone: z
    .string()
    .regex(/^(?:\+91)?[6-9]\d{9}$/)
    .optional(),
  isGuest: z.boolean().default(false),
  deliveryChannel: z.literal("WHATSAPP").optional(),
  deliveryConsent: z.boolean().default(false),
  idempotencyKey: z.string().optional(),
});
export async function quickPayRoutes(app: FastifyInstance) {
  app.post(
    "/quick-pay",
    {
      preHandler: [
        requireRoles(
          UserRole.OWNER,
          UserRole.FINANCE,
          UserRole.BRANCH_MANAGER,
          UserRole.COLLECTOR,
        ),
      ],
    },
    async (req, reply) => {
      const body = schema.parse(req.body);
      const { idempotencyKey, ...payload } = body;
      const key = String(
        req.headers["idempotency-key"] ?? idempotencyKey ?? randomUUID(),
      );
      if (
        body.deliveryChannel &&
        (!body.recipientPhone || !body.deliveryConsent)
      )
        throw Err.validation(
          "A recipient phone and permission to send WhatsApp are required",
        );
      const result = await prisma.$transaction(async (tx) => {
        const branch = await tx.branch.findFirst({
          where: { id: body.branchId, orgId: req.user.orgId, isActive: true },
        });
        const scope = branchScope(req.user, body.branchId);
        if (!branch || scope.branchId === "__unavailable__")
          throw Err.notFound("Branch");
        if (
          body.memberId &&
          !(await tx.member.findFirst({
            where: {
              id: body.memberId,
              orgId: req.user.orgId,
              status: "ACTIVE",
            },
          }))
        )
          throw Err.notFound("Active member");
        return once(tx, req.user.orgId, "quick-pay", key, payload, async () => {
          const bill = await tx.bill.create({
            data: {
              orgId: req.user.orgId,
              branchId: body.branchId,
              memberId: body.memberId,
              purpose: body.purpose,
              amountPaise: body.amountPaise,
              isGuest: body.isGuest,
              status: "ISSUED",
              dueAt: new Date(Date.now() + 86400000),
              paymentLinks: {
                create: { expiresAt: new Date(Date.now() + 86400000) },
              },
            },
            include: { paymentLinks: true },
          });
          const link = bill.paymentLinks[0];
          const checkoutUrl = `${process.env.WEB_URL ?? "http://localhost:3000"}/pay/${link.token}`;
          if (body.deliveryChannel)
            await tx.outboxEvent.create({
              data: {
                eventType: "QUICK_PAY_WHATSAPP",
                payload: {
                  orgId: req.user.orgId,
                  billId: bill.id,
                  phone: body.recipientPhone!,
                  consentedAt: new Date().toISOString(),
                  merchant: branch.name,
                  link: checkoutUrl,
                },
              },
            });
          await tx.auditEvent.create({
            data: {
              orgId: req.user.orgId,
              userId: req.user.sub,
              action: "QUICK_PAY_CREATE",
              entity: "Bill",
              entityId: bill.id,
              meta: {
                amountPaise: body.amountPaise,
                branchId: body.branchId,
                deliveryConsent: body.deliveryConsent,
              },
            },
          });
          return {
            billId: bill.id,
            paymentLinkToken: link.token,
            checkoutUrl,
            status: bill.status,
            deliveryStatus: body.deliveryChannel ? "QUEUED" : undefined,
          };
        });
      });
      return reply.code(201).send(result);
    },
  );
}
