import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

// Prisma's compound-unique `where` doesn't accept null for branchId,
// so we use findFirst + create for "all branches" (branchId = null) grants.
async function ensureOwnerGrant(orgId: string, userId: string) {
  const existing = await prisma.roleGrant.findFirst({
    where: { orgId, userId, role: "OWNER", branchId: null },
  });
  if (!existing) {
    await prisma.roleGrant.create({
      data: { orgId, userId, role: "OWNER" },
    });
  }
}

async function main() {
  console.log("Seeding demo data...");

  const hash = await bcrypt.hash("Demo1234!", 10);

  // --- SCHOOL ---
  const school = await prisma.organisation.upsert({
    where: { id: "demo-school" },
    create: { id: "demo-school", name: "Sunrise Public School", profile: "SCHOOL", status: "ACTIVE" },
    update: {},
  });
  const schoolBranch = await prisma.branch.upsert({
    where: { id: "school-main" },
    create: { id: "school-main", orgId: school.id, name: "Main Campus" },
    update: {},
  });
  const schoolOwner = await prisma.user.upsert({
    where: { email: "school.owner@demo.com" },
    create: { orgId: school.id, email: "school.owner@demo.com", passwordHash: hash, name: "Priya Sharma" },
    update: {},
  });
  await ensureOwnerGrant(school.id, schoolOwner.id);

  // Two siblings with the same guardian phone (AT-03)
  const memberA = await prisma.member.upsert({
    where: { orgId_externalRef: { orgId: school.id, externalRef: "STU-001" } },
    create: {
      orgId: school.id,
      name: "Arjun Sharma",
      externalRef: "STU-001",
      guardians: { create: [{ name: "Ravi Sharma", phone: "9876543210" }] },
    },
    update: {},
  });
  const memberB = await prisma.member.upsert({
    where: { orgId_externalRef: { orgId: school.id, externalRef: "STU-002" } },
    create: {
      orgId: school.id,
      name: "Priya Sharma",
      externalRef: "STU-002",
      guardians: { create: [{ name: "Ravi Sharma", phone: "9876543210" }] },
    },
    update: {},
  });
  const tuitionGroup = await prisma.group.upsert({
    where: { id: "school-class-6" },
    create: {
      id: "school-class-6",
      orgId: school.id,
      branchId: schoolBranch.id,
      name: "Class 6 Tuition",
      amountPaise: 400000,
      frequency: "MONTHLY",
      billDayOfMonth: 1,
      dueDayOffset: 7,
    },
    update: {},
  });
  for (const m of [memberA, memberB]) {
    await prisma.membership.upsert({
      where: { memberId_groupId: { memberId: m.id, groupId: tuitionGroup.id } },
      create: { memberId: m.id, groupId: tuitionGroup.id, orgId: school.id },
      update: {},
    });
  }

  // --- SPORTS ---
  const sports = await prisma.organisation.upsert({
    where: { id: "demo-sports" },
    create: { id: "demo-sports", name: "Champion Cricket Academy", profile: "SPORTS", status: "ACTIVE" },
    update: {},
  });
  await prisma.branch.upsert({
    where: { id: "sports-main" },
    create: { id: "sports-main", orgId: sports.id, name: "Academy Ground" },
    update: {},
  });
  const sportsOwner = await prisma.user.upsert({
    where: { email: "sports.owner@demo.com" },
    create: { orgId: sports.id, email: "sports.owner@demo.com", passwordHash: hash, name: "Rahul Verma" },
    update: {},
  });
  await ensureOwnerGrant(sports.id, sportsOwner.id);

  // --- RESTAURANT ---
  const restaurant = await prisma.organisation.upsert({
    where: { id: "demo-restaurant" },
    create: { id: "demo-restaurant", name: "Spice Garden", profile: "RESTAURANT", status: "ACTIVE" },
    update: {},
  });
  const restBranch = await prisma.branch.upsert({
    where: { id: "rest-main" },
    create: { id: "rest-main", orgId: restaurant.id, name: "MG Road Outlet" },
    update: {},
  });
  const restOwner = await prisma.user.upsert({
    where: { email: "restaurant.owner@demo.com" },
    create: { orgId: restaurant.id, email: "restaurant.owner@demo.com", passwordHash: hash, name: "Meena Patel" },
    update: {},
  });
  await ensureOwnerGrant(restaurant.id, restOwner.id);

  // Sample Quick Pay bill for restaurant (counter QR demo)
  await prisma.bill.upsert({
    where: { id: "demo-rest-bill-1" },
    create: {
      id: "demo-rest-bill-1",
      orgId: restaurant.id,
      branchId: restBranch.id,
      purpose: "Table 4 Order #42",
      amountPaise: 85000,
      isGuest: true,
      status: "ISSUED",
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      paymentLinks: { create: [{ expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }] },
    },
    update: {},
  });

  console.log("\n--- Demo credentials ---");
  console.log("School owner:     school.owner@demo.com / Demo1234!");
  console.log("Sports owner:     sports.owner@demo.com / Demo1234!");
  console.log("Restaurant owner: restaurant.owner@demo.com / Demo1234!");
  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());