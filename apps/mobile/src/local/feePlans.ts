import {
  cycleDate,
  localDate,
  billingInterval,
  addDays,
} from "../../../api/src/lib/billing";
import type { Row } from "./schema";

export const paymentPlans = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  FULL: "Full payment",
} as const;
export type PaymentPlan = keyof typeof paymentPlans;
export type FeeCharge = {
  name: string;
  amountPaise: number;
  upfront: boolean;
  optional: boolean;
};
export type FeePlan =
  | {
      mode: "SCHOOL";
      startsOn: string;
      hostelPaise: number;
      charges: FeeCharge[];
    }
  | {
      mode: "SPORTS_FIXED" | "SPORTS_RENEWAL";
      months: number;
      charges: FeeCharge[];
    };
const max = 50_000_000;
const paise = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;

export function readFeePlan(
  value: any,
  industry: string,
  base: number,
): FeePlan {
  const charges: unknown = value?.charges;
  if (
    !Array.isArray(charges) ||
    charges.length > 20 ||
    charges.some(
      (charge) =>
        !charge ||
        typeof charge.name !== "string" ||
        !charge.name.trim() ||
        charge.name.length > 60 ||
        !paise(charge.amountPaise) ||
        !charge.amountPaise ||
        typeof charge.upfront !== "boolean" ||
        typeof charge.optional !== "boolean",
    )
  )
    throw new Error("Enter a name and valid amount for each fee charge.");
  const normalized = charges.map((charge) => ({
    name: charge.name.trim(),
    amountPaise: charge.amountPaise,
    optional: charge.optional,
    upfront:
      charge.upfront ||
      /\b(books?|admission|registration|kit|uniforms?)\b/i.test(charge.name),
  })) as FeeCharge[];
  if (
    new Set(normalized.map((charge) => charge.name.toLowerCase())).size !==
    normalized.length
  )
    throw new Error("Fee charge names must be unique.");
  if (
    value.mode === "SCHOOL" &&
    industry === "SCHOOL" &&
    /^(?:19|[2-9]\d)\d{2}-(0[1-9]|1[0-2])-01$/.test(value.startsOn) &&
    paise(value.hostelPaise) &&
    base +
      value.hostelPaise +
      normalized.reduce((sum, charge) => sum + charge.amountPaise, 0) <=
      max
  )
    return {
      mode: "SCHOOL",
      startsOn: value.startsOn,
      hostelPaise: value.hostelPaise,
      charges: normalized,
    };
  if (
    industry === "SPORTS" &&
    ["SPORTS_FIXED", "SPORTS_RENEWAL"].includes(value.mode) &&
    [1, 3, 6, 12].includes(value.months) &&
    base + normalized.reduce((sum, charge) => sum + charge.amountPaise, 0) <=
      max
  )
    return { mode: value.mode, months: value.months, charges: normalized };
  throw new Error(
    "Check the start date, term and total fee (up to ₹5,00,000).",
  );
}

export function addMonths(date: string, offset: number) {
  const [year, month, day] = date.split("-").map(Number);
  const index = year * 12 + month - 1 + offset;
  return cycleDate(Math.floor(index / 12), index % 12, day);
}

export function enrollmentFields(group: Row, body: any, joinedOn: string) {
  const plan = group.feePlan as FeePlan;
  if (plan.mode === "SCHOOL" && joinedOn >= addMonths(plan.startsOn, 12))
    throw new Error(
      "This academic year has ended. Create a class for the new year.",
    );
  const paymentPlan =
    plan.mode === "SPORTS_RENEWAL" ? "FULL" : (body.paymentPlan ?? "MONTHLY");
  if (!Object.hasOwn(paymentPlans, paymentPlan))
    throw new Error("Choose a valid payment plan.");
  if (
    body.optionalCharges !== undefined &&
    (!Array.isArray(body.optionalCharges) ||
      body.optionalCharges.some(
        (name: unknown) =>
          !plan.charges.some(
            (charge) => charge.optional && charge.name === name,
          ),
      ))
  )
    throw new Error("Choose optional charges from this class or program.");
  return {
    paymentPlan,
    hostel: plan.mode === "SCHOOL" && body.hostel === true,
    optionalCharges: body.optionalCharges ?? [],
  };
}

export function feeSchedule(
  group: Row,
  membership: Row,
  concession: number,
  startsOn: string,
  renewal = false,
) {
  const plan = group.feePlan as FeePlan;
  const months = plan.mode === "SCHOOL" ? 12 : plan.months;
  const charges = plan.charges.filter(
    (charge) =>
      !charge.optional || membership.optionalCharges?.includes(charge.name),
  );
  const discount = Math.round((group.amountPaise * concession) / 100);
  const upfront = renewal
    ? 0
    : charges
        .filter((charge) => charge.upfront)
        .reduce((sum, charge) => sum + charge.amountPaise, 0);
  const recurring =
    group.amountPaise -
    discount +
    (plan.mode === "SCHOOL" && membership.hostel ? plan.hostelPaise : 0) +
    charges
      .filter((charge) => !charge.upfront)
      .reduce((sum, charge) => sum + charge.amountPaise, 0);
  const interval =
    membership.paymentPlan === "FULL"
      ? months
      : billingInterval(membership.paymentPlan);
  const count = Math.ceil(months / interval);
  const installment = Math.floor(recurring / count);
  const entries = Array.from({ length: count }, (_, index) => ({
    dueOn: addMonths(startsOn, index * interval),
    amountPaise: installment + (index === count - 1 ? recurring % count : 0),
  }));
  const joinedOn = localDate(new Date(membership.joinedAt));
  if (upfront) entries.push({ dueOn: joinedOn, amountPaise: upfront });
  return { entries, totalPaise: recurring + upfront, discountPaise: discount };
}

export function plannedBills(
  group: Row,
  membership: Row,
  member: Row,
  previous: Row[],
  today: string,
) {
  const plan = group.feePlan as FeePlan;
  const renewable = plan.mode === "SPORTS_RENEWAL";
  const joinedOn = localDate(new Date(membership.joinedAt));
  const first = plan.mode === "SCHOOL" ? plan.startsOn : joinedOn;
  const latest = previous.at(-1);
  const renews = latest?.renewsOn as string | undefined;
  const cycle =
    renewable && latest && renews && today >= addDays(renews, -7)
      ? previous.length
      : renewable
        ? Math.max(0, previous.length - 1)
        : 0;
  const old = previous[cycle];
  if (renewable && old?.renewsOn && old.paidPaise >= old.plannedTotalPaise)
    return [];
  if (
    !old &&
    (membership.leftAt || !group.isActive || member.status !== "ACTIVE")
  )
    return [];
  const startsOn = old?.startsOn ?? (cycle ? renews! : first);
  const schedule = feeSchedule(
    group,
    membership,
    member.concessionPercent ?? 0,
    startsOn,
    cycle > 0,
  );
  const leftOn = membership.leftAt && localDate(new Date(membership.leftAt));
  const chargeThrough =
    plan.mode === "SCHOOL" && leftOn && leftOn < today ? leftOn : today;
  const accrued =
    renewable && cycle > 0 && today >= addDays(startsOn, -7)
      ? schedule.totalPaise
      : schedule.entries
          .filter((entry) => entry.dueOn <= chargeThrough)
          .reduce((sum, entry) => sum + entry.amountPaise, 0);
  const paidPaise = old?.paidPaise ?? 0;
  const amountPaise = Math.max(accrued, paidPaise);
  const paidThrough =
    renewable && paidPaise >= schedule.totalPaise
      ? addMonths(
          old?.paidOn && old.paidOn > startsOn ? old.paidOn : startsOn,
          plan.months,
        )
      : undefined;
  return [
    {
      ...old,
      id: membership.id + "-plan-" + cycle,
      branchId: group.branchId ?? "main",
      membershipId: membership.id,
      memberId: member.id,
      groupId: group.id,
      planned: true,
      billingPeriod: startsOn.slice(0, 7),
      startsOn,
      dueDate: startsOn,
      purpose:
        group.name +
        " · " +
        member.name +
        (plan.mode === "SCHOOL" ? " · " + startsOn.slice(0, 7) : ""),
      amountPaise,
      paidPaise,
      plannedTotalPaise:
        plan.mode === "SCHOOL" && leftOn ? amountPaise : schedule.totalPaise,
      schedule: schedule.entries,
      discountPaise: schedule.discountPaise,
      renewsOn: paidThrough,
      status:
        paidPaise >= schedule.totalPaise && schedule.totalPaise
          ? "PAID"
          : amountPaise > paidPaise
            ? paidPaise
              ? "PARTIAL"
              : "ISSUED"
            : paidPaise
              ? "PAID"
              : schedule.totalPaise
                ? "DRAFT"
                : "WAIVED",
      createdAt: old?.createdAt ?? membership.joinedAt,
    },
  ];
}

export function parseFeeCharges(text: string) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [
        name,
        rupees,
        timing = "upfront",
        selection = "required",
        ...extra
      ] = line.split(",").map((value) => value.trim());
      if (
        !name ||
        !/^\d+(\.\d{1,2})?$/.test(rupees ?? "") ||
        !["upfront", "spread"].includes(timing) ||
        !["optional", "required"].includes(selection) ||
        extra.length
      )
        throw new Error(
          "Enter each charge as name, amount, upfront or spread, optional or required.",
        );
      const [whole, cents = ""] = rupees.split(".");
      return {
        name,
        amountPaise: Number(whole) * 100 + Number(cents.padEnd(2, "0")),
        upfront: timing === "upfront",
        optional: selection === "optional",
      };
    });
}
