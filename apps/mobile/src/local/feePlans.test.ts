import { test } from "node:test";
import assert from "node:assert/strict";
import { feeSchedule, plannedBills, readFeePlan } from "./feePlans";
const school = {
  id: "class-6",
  name: "Class 6",
  isActive: true,
  amountPaise: 4_800_000,
  feePlan: readFeePlan(
    {
      mode: "SCHOOL",
      startsOn: "2026-04-01",
      hostelPaise: 1_200_000,
      charges: [
        {
          name: "Books",
          amountPaise: 600_000,
          upfront: false,
          optional: false,
        },
        {
          name: "Transport",
          amountPaise: 300_000,
          upfront: false,
          optional: true,
        },
      ],
    },
    "SCHOOL",
    4_800_000,
  ),
};
const student = {
  id: "student-1",
  name: "Student",
  status: "ACTIVE",
  concessionPercent: 10,
};
const enrollment = {
  id: "enrollment-1",
  joinedAt: "2026-04-01T06:00:00Z",
  paymentPlan: "MONTHLY",
  hostel: true,
};

test("school upfront fees and missed installments carry into each month's balance", () => {
  const [april] = plannedBills(school, enrollment, student, [], "2026-04-01");
  assert.equal(april.plannedTotalPaise, 6_120_000);
  assert.equal(april.amountPaise, 1_060_000);
  const [may] = plannedBills(
    school,
    enrollment,
    student,
    [{ ...april, paidPaise: 200_000 }],
    "2026-05-01",
  );
  assert.equal(may.id, april.id);
  assert.equal(may.amountPaise - may.paidPaise, 1_320_000);
  const [june] = plannedBills(
    school,
    enrollment,
    student,
    [{ ...may, paidPaise: 2_000_000 }],
    "2026-06-01",
  );
  assert.equal(june.amountPaise, june.paidPaise);
  const [july] = plannedBills(
    school,
    enrollment,
    student,
    [june],
    "2026-07-01",
  );
  assert.equal(july.amountPaise - july.paidPaise, 440_000);
});

test("quarterly and full payments use the same annual balance and round exactly", () => {
  const quarterly = { ...enrollment, paymentPlan: "QUARTERLY" };
  const [april] = plannedBills(school, quarterly, student, [], "2026-04-01");
  const [may] = plannedBills(school, quarterly, student, [april], "2026-05-01");
  const [july] = plannedBills(school, quarterly, student, [may], "2026-07-01");
  assert.equal(april.amountPaise, 1_980_000);
  assert.equal(may.amountPaise, april.amountPaise);
  assert.equal(july.amountPaise, 3_360_000);
  const [annual] = plannedBills(
    school,
    { ...enrollment, paymentPlan: "FULL" },
    student,
    [],
    "2026-04-01",
  );
  assert.equal(annual.amountPaise, 6_120_000);
  const schedule = feeSchedule(
    { ...school, amountPaise: school.amountPaise + 1 },
    enrollment,
    0,
    "2026-04-01",
  );
  assert.equal(
    schedule.entries.reduce((sum, entry) => sum + entry.amountPaise, 0),
    schedule.totalPaise,
  );
});

test("sports renewals stop accumulating at one unpaid renewal, fixed terms continue", () => {
  const sports = {
    id: "badminton",
    name: "Badminton",
    isActive: true,
    amountPaise: 120_000,
    feePlan: {
      mode: "SPORTS_RENEWAL",
      months: 1,
      charges: [
        { name: "Kit", amountPaise: 40_000, upfront: true, optional: false },
      ],
    },
  };
  const member = { ...enrollment, paymentPlan: "FULL" };
  const [initial] = plannedBills(sports, member, student, [], "2026-04-01");
  assert.equal(initial.amountPaise, 148_000);
  const [paid] = plannedBills(
    sports,
    member,
    student,
    [{ ...initial, paidPaise: 148_000, paidOn: "2026-04-01" }],
    "2026-04-01",
  );
  assert.equal(paid.renewsOn, "2026-05-01");
  const [renewal] = plannedBills(sports, member, student, [paid], "2026-04-24");
  assert.equal(renewal.amountPaise, 108_000);
  const [overdue] = plannedBills(
    sports,
    member,
    student,
    [paid, renewal],
    "2026-07-01",
  );
  assert.equal(overdue.id, renewal.id);
  assert.equal(overdue.amountPaise, renewal.amountPaise);
  assert.equal(overdue.renewsOn, undefined);
  const [resumed] = plannedBills(
    sports,
    member,
    student,
    [paid, { ...overdue, paidPaise: 108_000, paidOn: "2026-07-01" }],
    "2026-07-01",
  );
  assert.equal(resumed.renewsOn, "2026-08-01");
  const fixed = {
    ...sports,
    feePlan: { ...sports.feePlan, mode: "SPORTS_FIXED", months: 3 },
  };
  const [atEnd] = plannedBills(fixed, enrollment, student, [], "2026-07-01");
  assert.equal(atEnd.amountPaise, 148_000);
});
