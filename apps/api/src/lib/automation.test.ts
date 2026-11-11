import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma.js";
import { issueBills, dispatchReminders } from "./automation.js";
// Opt in because this test needs an isolated local PostgreSQL database.
test(
  "concurrent billing deduplicates; paid/opted-out reminders suppress; quiet hours defer",
  { skip: process.env.RUN_DB_TESTS !== "1" },
  async () => {
    const org = await prisma.organisation.create({
      data: { name: "Automation test", profile: "SCHOOL", status: "ACTIVE" },
    });
    const now = new Date("2028-02-29T05:00:00Z");
    try {
      const branch = await prisma.branch.create({
        data: { orgId: org.id, name: "Test" },
      });
      const group = await prisma.group.create({
        data: {
          orgId: org.id,
          branchId: branch.id,
          name: "Leap year tuition",
          amountPaise: 10000,
          billDayOfMonth: 31,
          dueDayOffset: 0,
          createdAt: new Date("2028-01-01"),
          reminderPolicies: {
            create: [
              { offsetDays: 0, channels: ["WHATSAPP"], sendTimeIST: "10:00" },
            ],
          },
        },
      });
      const members = await Promise.all(
        ["Paid", "Opted out", "Eligible"].map((name, i) =>
          prisma.member.create({
            data: {
              orgId: org.id,
              name,
              guardians: {
                create: {
                  name: "Shared guardian",
                  phone: "9876543210",
                  optOut: i === 1,
                },
              },
              memberships: {
                create: {
                  orgId: org.id,
                  groupId: group.id,
                  joinedAt: new Date("2028-01-15"),
                },
              },
            },
          }),
        ),
      );
      const runs = await Promise.all([
        issueBills(org.id, now),
        issueBills(org.id, now),
      ]);
      assert.equal(
        runs.reduce((s, r) => s + r.issued, 0),
        3,
      );
      const bills = await prisma.bill.findMany({
        where: { orgId: org.id },
        include: { paymentLinks: true },
      });
      assert.equal(bills.length, 3);
      assert(bills.every((b) => b.billingPeriod === "2028-02"));
      await prisma.bill.updateMany({
        where: { orgId: org.id, memberId: members[0].id },
        data: { status: "PAID", paidPaise: 10000 },
      });
      await dispatchReminders(new Date("2028-02-29T17:00:00Z"));
      let messages = await prisma.messageOccurrence.findMany({
        where: { billId: { in: bills.map((b) => b.id) } },
      });
      assert.equal(messages.filter((m) => m.status === "SUPPRESSED").length, 2);
      assert.equal(messages.filter((m) => m.status === "QUEUED").length, 1);
      await Promise.all([dispatchReminders(now), dispatchReminders(now)]);
      messages = await prisma.messageOccurrence.findMany({
        where: { billId: { in: bills.map((b) => b.id) } },
      });
      assert.equal(messages.filter((m) => m.status === "SUBMITTED").length, 1);
      assert.equal(messages.find((m) => m.status === "SUBMITTED")?.attempts, 1);
      const eligibleBill = bills.find((b) => b.memberId === members[2].id)!;
      const guardian = await prisma.guardian.findFirstOrThrow({
        where: { memberId: members[2].id },
      });
      const policy = await prisma.reminderPolicy.findFirstOrThrow({
        where: { groupId: group.id },
      });
      await prisma.reminderPolicy.update({
        where: { id: policy.id },
        data: { channels: ["WHATSAPP", "SMS"] },
      });
      const failure = await prisma.messageOccurrence.create({
        data: {
          billId: eligibleBill.id,
          guardianId: guardian.id,
          channel: "WHATSAPP",
          templateKey: "reminder_before",
          scheduledAt: now,
          occurrenceKey: `failure:${policy.id}`,
        },
      });
      process.env.FAKE_WHATSAPP_RESULT = "FAILED";
      await dispatchReminders(now);
      const fallback = await prisma.messageOccurrence.findUniqueOrThrow({
        where: { occurrenceKey: failure.occurrenceKey + ":fallback" },
      });
      assert.equal(fallback.channel, "SMS");
      delete process.env.FAKE_WHATSAPP_RESULT;
      await dispatchReminders(now);
      assert.equal(
        (
          await prisma.messageOccurrence.findUniqueOrThrow({
            where: { id: fallback.id },
          })
        ).status,
        "SUBMITTED",
      );
      const unknown = await prisma.messageOccurrence.create({
        data: {
          billId: eligibleBill.id,
          guardianId: guardian.id,
          channel: "WHATSAPP",
          templateKey: "reminder_before",
          scheduledAt: now,
          occurrenceKey: `unknown:${policy.id}`,
        },
      });
      process.env.FAKE_WHATSAPP_RESULT = "UNKNOWN";
      await dispatchReminders(now);
      delete process.env.FAKE_WHATSAPP_RESULT;
      await dispatchReminders(now);
      const unresolved = await prisma.messageOccurrence.findUniqueOrThrow({
        where: { id: unknown.id },
      });
      assert.equal(unresolved.status, "UNKNOWN");
      assert.equal(unresolved.attempts, 1);
      assert.equal(
        await prisma.messageOccurrence.count({
          where: { occurrenceKey: unknown.occurrenceKey + ":fallback" },
        }),
        0,
      );
    } finally {
      delete process.env.FAKE_WHATSAPP_RESULT;
      const bills = await prisma.bill.findMany({
        where: { orgId: org.id },
        select: { id: true },
      });
      const ids = bills.map((b) => b.id);
      await prisma.messageOccurrence.deleteMany({
        where: { billId: { in: ids } },
      });
      await prisma.paymentLink.deleteMany({ where: { billId: { in: ids } } });
      await prisma.bill.deleteMany({ where: { orgId: org.id } });
      await prisma.membership.deleteMany({ where: { orgId: org.id } });
      await prisma.guardian.deleteMany({
        where: { member: { orgId: org.id } },
      });
      await prisma.member.deleteMany({ where: { orgId: org.id } });
      await prisma.reminderPolicy.deleteMany({
        where: { group: { orgId: org.id } },
      });
      await prisma.group.deleteMany({ where: { orgId: org.id } });
      await prisma.branch.deleteMany({ where: { orgId: org.id } });
      await prisma.organisation.delete({ where: { id: org.id } });
      await prisma.$disconnect();
    }
  },
);
