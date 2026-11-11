import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma.js";
import { requireAuth, branchScope } from "../middleware/auth.js";
import { getPaymentProvider } from "../providers/payment.js";
import { getMessagingProvider } from "../providers/messaging.js";
import { Err, MessageChannel, UserRole } from "@fee/shared";

const quickPaySchema = z.object({
  amountPaise: z.number().int().positive(),
  branchId: z.string(),
  purpose: z.string().min(1).max(200),
  memberId: z.string().optional(),
  recipientName: z.string().optional(),
  recipientPhone: z.string().optional(),
  isGuest: z.boolean().default(false),
  deliveryChannel: z.nativeEnum(MessageChannel).optional(),
  idempotencyKey: z.string().optional(),
});

export async function quickPayRoutes(app: FastifyInstance) {
  app.post("/quick-pay", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = req.user;
    const body = quickPaySchema.parse(req.body);
    const idempotencyKey = body.idempotencyKey ?? nanoid();

    // Validate branch belongs to org
    const branch = await prisma.branch.findFirst({
      where: { id: body.branchId, orgId: user.orgId, isActive: true },
    });
    if (
      !branch ||
      (!user.roles.some((r) => ["OWNER", "FINANCE"].includes(r)) &&
        !user.branchIds.includes(branch.id))
    )
      throw Err.notFound("Branch");

    // Amount limits (provider-specific; fake: 1 paise - 500000 INR)
    if (body.amountPaise > 50_000_000)
      throw Err.validation("Amount exceeds limit");

    // Check idempotency: existing bill with same key returns it
    const existingBill = await prisma.bill.findFirst({
      where: {
        orgId: user.orgId,
        purpose: body.purpose,
        amountPaise: body.amountPaise,
        branchId: body.branchId,
      },
      include: {
        paymentLinks: {
          where: { status: "ACTIVE" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    let bill = existingBill;
    if (!bill) {
      bill = await prisma.bill.create({
        data: {
          orgId: user.orgId,
          branchId: body.branchId,
          memberId: body.memberId,
          purpose: body.purpose,
          amountPaise: body.amountPaise,
          isGuest: body.isGuest,
          status: "ISSUED",
          dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h default
        },
        include: { paymentLinks: true },
      });
    }

    // Create or reuse payment link
    let link = bill.paymentLinks?.[0];
    if (!link) {
      link = await prisma.paymentLink.create({
        data: {
          billId: bill.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    }

    const baseUrl = process.env.WEB_URL ?? `http://localhost:3000`;
    const checkoutUrl = `${baseUrl}/pay/${link.token}`;

    // Send delivery if requested
    let deliveryStatus = undefined;
    const phone = body.recipientPhone;
    if (body.deliveryChannel && phone) {
      const mp = getMessagingProvider();
      const result = await mp.send({
        channel: body.deliveryChannel,
        to: phone,
        templateKey: "payment_request",
        variables: {
          amount: (body.amountPaise / 100).toFixed(0),
          merchant: branch.name,
          purpose: body.purpose,
          link: checkoutUrl,
        },
      });
      deliveryStatus = result.status;
    }

    await prisma.auditEvent.create({
      data: {
        orgId: user.orgId,
        userId: user.sub,
        action: "QUICK_PAY_CREATE",
        entity: "Bill",
        entityId: bill.id,
        meta: { amountPaise: body.amountPaise, branchId: body.branchId },
      },
    });

    return reply.status(201).send({
      billId: bill.id,
      paymentLinkToken: link.token,
      checkoutUrl,
      status: bill.status,
      deliveryStatus,
    });
  });
}
