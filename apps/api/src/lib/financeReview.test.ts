import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { prisma } from "./prisma.js";
import { financeReviewRoutes } from "../routes/financeReview.js";
import { errorHandler } from "../middleware/error.js";
test(
  "destination reviews require separate current actors and never imply bank verification",
  { skip: process.env.RUN_DB_TESTS !== "1" },
  async () => {
    const app = Fastify();
    await app.register(jwt, { secret: "test-only-secret" });
    app.setErrorHandler(errorHandler);
    await app.register(financeReviewRoutes, { prefix: "/v1" });
    const org = await prisma.organisation.create({
      data: { name: "Finance test", profile: "SCHOOL" },
    });
    try {
      const maker = await prisma.user.create({
        data: {
          orgId: org.id,
          name: "Maker",
          email: randomUUID() + "@test.invalid",
          passwordHash: "unused",
          roleGrants: { create: { orgId: org.id, role: "OWNER" } },
        },
      });
      const checker = await prisma.user.create({
        data: {
          orgId: org.id,
          name: "Checker",
          email: randomUUID() + "@test.invalid",
          passwordHash: "unused",
          roleGrants: { create: { orgId: org.id, role: "FINANCE" } },
        },
      });
      const token = (u: typeof maker) =>
        app.jwt.sign({ sub: u.id, orgId: org.id, roles: [], branchIds: [] });
      const created = await app.inject({
        method: "POST",
        url: "/v1/destinations",
        headers: { authorization: "Bearer " + token(maker) },
        payload: { lastFour: "1234", ifsc: "HDFC0000001" },
      });
      assert.equal(created.statusCode, 200);
      const d = created.json();
      assert.equal(d.status, "REQUESTED");
      assert.equal(d.maskedValue, "••••1234");
      const approve = (u: typeof maker) =>
        app.inject({
          method: "POST",
          url: `/v1/destinations/${d.id}/approve`,
          headers: { authorization: "Bearer " + token(u) },
          payload: {},
        });
      assert.equal((await approve(maker)).statusCode, 403);
      const approved = await approve(checker);
      assert.equal(approved.statusCode, 200);
      assert.equal(approved.json().status, "APPROVED_PENDING_VERIFICATION");
      assert.equal(
        await prisma.destinationVersion.count({ where: { orgId: org.id } }),
        0,
      );
      assert.equal((await approve(checker)).json().id, d.id);
      assert.equal(
        await prisma.auditEvent.count({
          where: { orgId: org.id, action: "DESTINATION_REVIEW_APPROVED" },
        }),
        1,
      );
      const operations = await app.inject({
        url: "/v1/operations",
        headers: { authorization: "Bearer " + token(maker) },
      });
      assert.equal(operations.json().payoutExecutionEnabled, false);
    } finally {
      await app.close();
      await prisma.auditEvent.deleteMany({ where: { orgId: org.id } });
      await prisma.requestResult.deleteMany({ where: { orgId: org.id } });
      await prisma.destinationChange.deleteMany({ where: { orgId: org.id } });
      await prisma.roleGrant.deleteMany({ where: { orgId: org.id } });
      await prisma.user.deleteMany({ where: { orgId: org.id } });
      await prisma.organisation.delete({ where: { id: org.id } });
      await prisma.$disconnect();
    }
  },
);
