import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "./prisma.js";
import {
  recordVerifiedPayment,
  verifiedPaymentSchema,
} from "./verifiedPayment.js";

test("verification requires explicit attestation, integer paise and a valid reference", () => {
  const body = {
    amountPaise: 100,
    reference: "123456789012",
    receivedAt: new Date().toISOString(),
    verificationMethod: "UPI_APP",
    verified: true,
  };
  assert(verifiedPaymentSchema.safeParse(body).success);
  for (const change of [
    { verified: false },
    { amountPaise: 0 },
    { amountPaise: 100.1 },
    { reference: "short" },
    { verificationMethod: "SCREENSHOT" },
  ])
    assert(!verifiedPaymentSchema.safeParse({ ...body, ...change }).success);
});

test(
  "manual verification: permissions, duplicate safety, partial/full allocation, concurrency, audit and settlement source",
  { skip: process.env.RUN_DB_TESTS !== "1" },
  async () => {
    const oldMode = process.env.PAYMENT_PROVIDER;
    process.env.PAYMENT_PROVIDER = "manual-upi";
    const org = await prisma.organisation.create({
      data: {
        name: "Manual payment test",
        profile: "RESTAURANT",
        status: "ACTIVE",
      },
    });
    const unique = randomUUID().replaceAll("-", "");
    try {
      const user = await prisma.user.create({
        data: {
          orgId: org.id,
          email: `${unique}@test.invalid`,
          name: "Test verifier",
          passwordHash: "unused",
        },
      });
      const grant = await prisma.roleGrant.create({
        data: { orgId: org.id, userId: user.id, role: "OWNER" },
      });
      const collector = await prisma.user.create({
        data: {
          orgId: org.id,
          email: `collector-${unique}@test.invalid`,
          name: "Collector",
          passwordHash: "unused",
          roleGrants: { create: { orgId: org.id, role: "COLLECTOR" } },
        },
      });
      const branch = await prisma.branch.create({
        data: { orgId: org.id, name: "Test" },
      });
      async function bill(name: string) {
        return prisma.bill.create({
          data: {
            orgId: org.id,
            branchId: branch.id,
            purpose: name,
            amountPaise: 10000,
            paymentLinks: {
              create: { expiresAt: new Date(Date.now() + 86400_000) },
            },
          },
          include: { paymentLinks: true },
        });
      }
      const first = await bill("Partial/full");
      const second = await bill("Concurrent");
      const queued = await prisma.messageOccurrence.create({
        data: {
          billId: first.id,
          channel: "SMS",
          templateKey: "reminder_before",
          scheduledAt: new Date(),
          occurrenceKey: unique,
        },
      });
      const pending = await prisma.paymentAttempt.create({
        data: {
          linkId: first.paymentLinks[0].id,
          providerOrderId: `pending-${unique}`,
          amountPaise: 10000,
        },
      });
      const actor = { sub: user.id, orgId: org.id };
      const input = {
        amountPaise: 4000,
        reference: `FIRST-${unique}`,
        receivedAt: new Date().toISOString(),
        verificationMethod: "BANK_STATEMENT",
        note: "Synthetic test",
        verified: true,
      };
      await assert.rejects(
        recordVerifiedPayment(
          { sub: collector.id, orgId: org.id },
          first.id,
          input,
        ),
        (e) => (e as { statusCode: number }).statusCode === 403,
      );
      await assert.rejects(
        recordVerifiedPayment(
          { ...actor, orgId: "other-tenant" },
          first.id,
          input,
        ),
      );
      await assert.rejects(
        recordVerifiedPayment(actor, first.id, {
          ...input,
          receivedAt: new Date(Date.now() + 3600_000).toISOString(),
        }),
      );
      const result = await recordVerifiedPayment(actor, first.id, input);
      assert.equal(result.status, "PARTIAL");
      assert.equal(result.remainingPaise, 6000);
      assert.equal(
        (
          await prisma.paymentAttempt.findUniqueOrThrow({
            where: { id: pending.id },
          })
        ).status,
        "EXPIRED",
      );
      assert.equal(
        (await recordVerifiedPayment(actor, first.id, input)).receiptNo,
        result.receiptNo,
      );
      assert.equal(
        (await recordVerifiedPayment(actor, first.id, input)).replayed,
        true,
      );
      await assert.rejects(
        recordVerifiedPayment(actor, second.id, input),
        (e) => (e as { statusCode: number }).statusCode === 409,
      );
      await assert.rejects(
        recordVerifiedPayment(actor, first.id, {
          ...input,
          note: "Changed request",
        }),
        (e) => (e as { statusCode: number }).statusCode === 409,
      );
      await assert.rejects(
        recordVerifiedPayment(actor, first.id, {
          ...input,
          reference: `OVER-${unique}`,
          amountPaise: 7000,
        }),
      );
      await recordVerifiedPayment(actor, first.id, {
        ...input,
        reference: `FINAL-${unique}`,
        amountPaise: 6000,
      });
      assert.equal(
        (await prisma.bill.findUniqueOrThrow({ where: { id: first.id } }))
          .status,
        "PAID",
      );
      assert.equal(
        (
          await prisma.paymentLink.findUniqueOrThrow({
            where: { id: first.paymentLinks[0].id },
          })
        ).status,
        "PAID",
      );
      assert.equal(
        (
          await prisma.messageOccurrence.findUniqueOrThrow({
            where: { id: queued.id },
          })
        ).status,
        "SUPPRESSED",
      );
      const concurrent = await Promise.allSettled([
        recordVerifiedPayment(actor, second.id, {
          ...input,
          reference: `RACE1-${unique}`,
          amountPaise: 8000,
        }),
        recordVerifiedPayment(actor, second.id, {
          ...input,
          reference: `RACE2-${unique}`,
          amountPaise: 8000,
        }),
      ]);
      assert.equal(
        concurrent.filter((r) => r.status === "fulfilled").length,
        1,
      );
      assert.equal(
        (await prisma.bill.findUniqueOrThrow({ where: { id: second.id } }))
          .paidPaise,
        8000,
      );
      const payments = await prisma.payment.findMany({
        where: { orgId: org.id },
      });
      assert.equal(payments.length, 3);
      assert(
        payments.every(
          (p) => p.source === "MANUAL_UPI" && p.recordedBy === user.id,
        ),
      );
      const ledger = await prisma.ledgerEntry.findMany({
        where: { orgId: org.id },
      });
      assert.equal(
        ledger.reduce((sum, e) => sum + e.amountPaise, 0),
        18000,
      );
      assert(ledger.every((e) => e.source === "MANUAL_UPI"));
      assert.equal(
        await prisma.auditEvent.count({
          where: { orgId: org.id, action: "PAYMENT_MANUALLY_VERIFIED" },
        }),
        3,
      );
      await prisma.roleGrant.update({
        where: { id: grant.id },
        data: { revokedAt: new Date() },
      });
      await assert.rejects(
        recordVerifiedPayment(actor, second.id, {
          ...input,
          reference: `REVOKED-${unique}`,
          amountPaise: 1000,
        }),
        (e) => (e as { statusCode: number }).statusCode === 403,
      );
    } finally {
      const bills = await prisma.bill.findMany({
        where: { orgId: org.id },
        select: { id: true },
      });
      const ids = bills.map((b) => b.id);
      await prisma.auditEvent.deleteMany({ where: { orgId: org.id } });
      await prisma.messageOccurrence.deleteMany({
        where: { billId: { in: ids } },
      });
      await prisma.ledgerEntry.deleteMany({ where: { orgId: org.id } });
      await prisma.allocation.deleteMany({ where: { billId: { in: ids } } });
      await prisma.payment.deleteMany({ where: { orgId: org.id } });
      await prisma.paymentAttempt.deleteMany({
        where: { link: { billId: { in: ids } } },
      });
      await prisma.paymentLink.deleteMany({ where: { billId: { in: ids } } });
      await prisma.bill.deleteMany({ where: { orgId: org.id } });
      await prisma.roleGrant.deleteMany({ where: { orgId: org.id } });
      await prisma.user.deleteMany({ where: { orgId: org.id } });
      await prisma.branch.deleteMany({ where: { orgId: org.id } });
      await prisma.organisation.delete({ where: { id: org.id } });
      if (oldMode === undefined) delete process.env.PAYMENT_PROVIDER;
      else process.env.PAYMENT_PROVIDER = oldMode;
      await prisma.$disconnect();
    }
  },
);
