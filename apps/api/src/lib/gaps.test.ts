import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { randomUUID } from "node:crypto";
import { prisma } from "./prisma.js";
import { quickPayRoutes } from "../routes/quickPay.js";
import { groupRoutes } from "../routes/groups.js";
import { refundRoutes } from "../routes/refunds.js";
import { errorHandler } from "../middleware/error.js";
import { dispatchQuickPay } from "./quickPayOutbox.js";
import { issueBills } from "./automation.js";
test(
  "audit gaps: key replay/conflicts, tenant and branch boundaries, historical rules and refund isolation",
  { skip: process.env.RUN_DB_TESTS !== "1" },
  async () => {
    const app = Fastify();
    await app.register(jwt, { secret: "test-only-secret" });
    app.setErrorHandler(errorHandler);
    await app.register(quickPayRoutes, { prefix: "/v1" });
    await app.register(groupRoutes, { prefix: "/v1/groups" });
    await app.register(refundRoutes, { prefix: "/v1/refunds" });
    const org = await prisma.organisation.create({
      data: { name: "Gap regression", profile: "SCHOOL" },
    });
    const other = await prisma.organisation.create({
      data: { name: "Other test", profile: "SCHOOL" },
    });
    const orgIds = [org.id, other.id];
    try {
      const branch = await prisma.branch.create({
        data: { orgId: org.id, name: "Assigned" },
      });
      const unassigned = await prisma.branch.create({
        data: { orgId: org.id, name: "Unassigned" },
      });
      const owner = await prisma.user.create({
        data: {
          orgId: org.id,
          email: randomUUID() + "@test.invalid",
          name: "Owner",
          passwordHash: "unused",
          roleGrants: { create: { orgId: org.id, role: "OWNER" } },
        },
      });
      const manager = await prisma.user.create({
        data: {
          orgId: org.id,
          email: randomUUID() + "@test.invalid",
          name: "Manager",
          passwordHash: "unused",
          roleGrants: {
            create: {
              orgId: org.id,
              role: "BRANCH_MANAGER",
              branchId: branch.id,
            },
          },
        },
      });
      const otherOwner = await prisma.user.create({
        data: {
          orgId: other.id,
          email: randomUUID() + "@test.invalid",
          name: "Other",
          passwordHash: "unused",
          roleGrants: { create: { orgId: other.id, role: "OWNER" } },
        },
      });
      const member = await prisma.member.create({
        data: { orgId: org.id, name: "Local" },
      });
      const foreign = await prisma.member.create({
        data: { orgId: other.id, name: "Foreign" },
      });
      const token = (user: typeof owner, roles: string[]) =>
        app.jwt.sign({ sub: user.id, orgId: user.orgId, roles, branchIds: [] });
      async function request(
        url: string,
        body: unknown,
        key: string,
        actor = owner,
        roles = ["OWNER"],
        method = "POST",
      ) {
        return app.inject({
          method: method as "POST",
          url,
          headers: {
            authorization: "Bearer " + token(actor, roles),
            "idempotency-key": key,
          },
          ...(body ? { payload: body } : {}),
        });
      }
      const data = {
        branchId: branch.id,
        purpose: "Same purpose",
        amountPaise: 1234,
        isGuest: true,
      };
      const [one, two] = await Promise.all([
        request("/v1/quick-pay", data, "same"),
        request("/v1/quick-pay", data, "same"),
      ]);
      assert.equal(one.statusCode, 201);
      assert.equal(two.json().billId, one.json().billId);
      const distinct = await request("/v1/quick-pay", data, "distinct");
      assert.notEqual(distinct.json().billId, one.json().billId);
      assert.equal(
        (await request("/v1/quick-pay", { ...data, amountPaise: 4567 }, "same"))
          .statusCode,
        409,
      );
      assert.equal(
        (
          await request(
            "/v1/quick-pay",
            { ...data, memberId: foreign.id },
            "foreign",
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await request(
            "/v1/quick-pay",
            {
              ...data,
              deliveryChannel: "WHATSAPP",
              recipientPhone: "9876543210",
            },
            "no-consent",
          )
        ).statusCode,
        400,
      );
      const delivery = await request(
        "/v1/quick-pay",
        {
          ...data,
          deliveryChannel: "WHATSAPP",
          recipientPhone: "9876543210",
          deliveryConsent: true,
        },
        "delivery",
      );
      assert.equal(delivery.json().deliveryStatus, "QUEUED");
      await request(
        "/v1/quick-pay",
        {
          ...data,
          deliveryChannel: "WHATSAPP",
          recipientPhone: "9876543210",
          deliveryConsent: true,
        },
        "delivery",
      );
      assert.equal(
        await prisma.outboxEvent.count({
          where: {
            payload: { path: ["billId"], equals: delivery.json().billId },
          },
        }),
        1,
      );
      await dispatchQuickPay();
    const outbox=await prisma.outboxEvent.findFirstOrThrow({where:{payload:{path:["billId"],equals:delivery.json().billId}}});
    assert.equal((outbox.payload as {status:string}).status,"SUBMITTED");
    await dispatchQuickPay();
    assert.equal((await prisma.outboxEvent.findUniqueOrThrow({where:{id:outbox.id}})).processedAt?.getTime(),outbox.processedAt?.getTime());
    const group = await prisma.group.create({
        data: {
          orgId: org.id,
          branchId: unassigned.id,
          name: "Restricted",
          amountPaise: 1000,
        },
      });
      await prisma.membership.create({
        data: { orgId: org.id, groupId: group.id, memberId: member.id },
      });
      assert.equal(
        (
          await request(
            `/v1/groups/${group.id}/members/${member.id}`,
            undefined,
            "remove",
            manager,
            ["BRANCH_MANAGER"],
            "DELETE",
          )
        ).statusCode,
        404,
      );
      const localGroup = await prisma.group.create({
        data: {
          orgId: org.id,
          branchId: branch.id,
          name: "Local group",
          amountPaise: 1000,
        },
      });
      const enrollment = await request(
        `/v1/groups/${localGroup.id}/members`,
        { memberId: member.id },
        "join",
      );
      assert.equal(enrollment.statusCode, 200);
      assert.equal(
        (
          await request(
            `/v1/groups/${localGroup.id}/members`,
            { memberId: member.id },
            "join",
          )
        ).json().membership.id,
        enrollment.json().membership.id,
      );
      assert.equal(
        (
          await request(
            `/v1/groups/${localGroup.id}/members`,
            { memberId: member.id, amountPaise: 1200 },
            "join",
          )
        ).statusCode,
        409,
      );
      const billId = one.json().billId;
      await prisma.bill.update({
        where: { id: billId },
        data: { paidPaise: 1234, status: "PAID" },
      });
      const refund = { billId, amountPaise: 1000, reason: "Test" };
      const first = await request("/v1/refunds", refund, "refund");
      assert.equal(first.statusCode, 201);
      assert.equal(
        (await request("/v1/refunds", refund, "refund")).json().id,
        first.json().id,
      );
      assert.equal(
        (await request("/v1/refunds", refund, "refund", otherOwner)).statusCode,
        404,
      );
      assert.equal(
        (
          await request(
            "/v1/refunds",
            { ...refund, reason: "Changed" },
            "refund",
          )
        ).statusCode,
        409,
      );
      assert.equal(
        (await request("/v1/refunds", refund, "another-refund")).statusCode,
        400,
      );
      const history = await prisma.group.create({
        data: {
          orgId: org.id,
          branchId: branch.id,
          name: "History",
          amountPaise: 2000,
          billDayOfMonth: 31,
          createdAt: new Date("2028-01-01"),
        },
      });
      await prisma.membership.create({
        data: {
          orgId: org.id,
          groupId: history.id,
          memberId: member.id,
          joinedAt: new Date("2028-01-01"),
        },
      });
      const rules = {
        frequency: "MONTHLY",
        billDayOfMonth: 31,
        dueDayOffset: 7,
        isActive: true,
        endsAt: null,
      };
      await prisma.billingRuleVersion.createMany({
        data: [
          {
            groupId: history.id,
            effectiveAt: new Date("2028-01-01"),
            rules: { ...rules, amountPaise: 1000 },
          },
          {
            groupId: history.id,
            effectiveAt: new Date("2028-02-01"),
            rules: { ...rules, amountPaise: 2000 },
          },
        ],
      });
      await issueBills(org.id, new Date("2028-03-31T06:00:00Z"));
      const historical = await prisma.bill.findMany({
        where: { groupId: history.id },
        orderBy: { billingPeriod: "asc" },
      });
      assert.deepEqual(
        historical.map((b) => [b.billingPeriod, b.amountPaise]),
        [
          ["2028-01", 1000],
          ["2028-02", 2000],
          ["2028-03", 2000],
        ],
      );
      const before = historical.map((b) => b.id);
      await issueBills(org.id, new Date("2028-03-31T06:00:00Z"));
      assert.equal(
        await prisma.bill.count({ where: { id: { in: before } } }),
        3,
      );
      // Revoking a grant takes effect even while its old token still carries OWNER.
      await prisma.roleGrant.updateMany({
        where: { userId: owner.id },
        data: { revokedAt: new Date() },
      });
      assert.equal(
        (await request("/v1/quick-pay", data, "revoked")).statusCode,
        403,
      );
    } finally {
      await app.close();
      const groups = await prisma.group.findMany({
        where: { orgId: { in: orgIds } },
      });
      const bills = await prisma.bill.findMany({
        where: { orgId: { in: orgIds } },
      });
      await prisma.outboxEvent.deleteMany({
        where: {
          eventType: "QUICK_PAY_WHATSAPP",
          OR: orgIds.map((id) => ({
            payload: { path: ["orgId"], equals: id },
          })),
        },
      });
      await prisma.requestResult.deleteMany({
        where: { orgId: { in: orgIds } },
      });
      await prisma.billingRuleVersion.deleteMany({
        where: { groupId: { in: groups.map((g) => g.id) } },
      });
      await prisma.messageOccurrence.deleteMany({
        where: { billId: { in: bills.map((b) => b.id) } },
      });
      await prisma.auditEvent.deleteMany({ where: { orgId: { in: orgIds } } });
      await prisma.refund.deleteMany({
        where: { billId: { in: bills.map((b) => b.id) } },
      });
      await prisma.paymentLink.deleteMany({
        where: { billId: { in: bills.map((b) => b.id) } },
      });
      await prisma.bill.deleteMany({ where: { orgId: { in: orgIds } } });
      await prisma.membership.deleteMany({ where: { orgId: { in: orgIds } } });
      await prisma.member.deleteMany({ where: { orgId: { in: orgIds } } });
      await prisma.group.deleteMany({ where: { orgId: { in: orgIds } } });
      await prisma.roleGrant.deleteMany({ where: { orgId: { in: orgIds } } });
      await prisma.user.deleteMany({ where: { orgId: { in: orgIds } } });
      await prisma.branch.deleteMany({ where: { orgId: { in: orgIds } } });
      await prisma.organisation.deleteMany({ where: { id: { in: orgIds } } });
      await prisma.$disconnect();
    }
  },
);
