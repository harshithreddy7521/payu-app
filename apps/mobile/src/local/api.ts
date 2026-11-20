import {
  addBalance,
  emptyBalance,
  payable,
  remaining,
  type BalanceBill,
} from "./memberBalance";
import {
  addMonths,
  enrollmentFields,
  feeSchedule,
  plannedBills,
  readFeePlan,
  type FeePlan,
} from "./feePlans";
import { memberCsv } from "../../../api/src/lib/csv";
import { indianMobile, sharePaymentLink, whatsappPayment } from "./whatsapp";
import {
  upiUrl,
  validVpa,
  validateSchool,
  type SchoolProfile,
} from "./onboarding";
import { all, put, tx, id, randomBytes } from "./repository";
import { hex, passwordKey, sameSecret } from "./crypto";
import { Row } from "./schema";
import {
  nextBillDates,
  billingInterval,
  istInstant,
  localDate,
  cycleDate,
  addDays,
} from "../../../api/src/lib/billing";
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
let sessions = new Map<string, string>();
export function lock() {
  sessions.clear();
}
export async function account(token?: string) {
  const uid = token && sessions.get(token);
  const u = (await all("users")).find((u) => u.id === uid && u.active);
  if (!u) throw new ApiError("Unlock Feeflow to continue.", 401);
  return u;
}
export async function admin(token?: string) {
  const u = await account(token);
  if (u.role !== "OWNER")
    throw new ApiError("Administrator access required.", 403);
  return u;
}
export async function checkPassword(user: Row, password: string) {
  const key = await passwordKey(password, user.salt);
  try {
    return sameSecret(hex(key), user.hash);
  } finally {
    key.fill(0);
  }
}
export async function passwordFields(password: string) {
  if (password.length < 10 || password.length > 256)
    throw new Error("Use a password between 10 and 256 characters.");
  const salt = hex(randomBytes(16));
  const key = await passwordKey(password, salt);
  try {
    return { salt, hash: hex(key) };
  } finally {
    key.fill(0);
  }
}

export async function createUser(
  email: string,
  name: string,
  password: string,
  role = "OWNER",
) {
  if (
    !name.trim() ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    password.length < 10 ||
    !["OWNER", "BRANCH_MANAGER", "COLLECTOR"].includes(role)
  )
    throw new Error(
      "Enter a valid name/email and a password of at least 10 characters.",
    );
  if ((await all("users")).some((u) => u.email === email.toLowerCase().trim()))
    throw new Error("An account with this email exists.");
  await put("users", {
    id: id(),
    email: email.toLowerCase().trim(),
    name: name.trim(),
    role,
    ...(await passwordFields(password)),
    active: true,
  });
}
export async function setup(
  name: string,
  email: string,
  password: string,
  business: SchoolProfile,
  cloud?: { envelope: string; recoveryEnvelope?: string; workspaceId: string },
) {
  await tx(async () => {
    if ((await all("users")).length)
      throw new Error("This device is already configured.");
    validateSchool(business);
    await createUser(email, name, password);
    await put("settings", {
      id: "business",
      ...business,
      name: business.name.trim(),
      address: business.address.trim(),
      phone: business.phone.trim(),
      vpa: business.vpa.trim(),
      paymentMode: "upi",
    });
    if (cloud) await put("settings", { id: "cloud-credentials", ...cloud });
    await put("branches", { id: "main", name: "Main branch" });
  });
}
async function audit(user: Row, action: string, entityId: string) {
  await put("audit", {
    id: id(),
    userId: user.id,
    action,
    entityId,
    at: new Date().toISOString(),
  });
}
function positive(n: unknown) {
  if (!Number.isSafeInteger(n) || Number(n) <= 0 || Number(n) > 50000000)
    throw new Error("Invalid amount.");
}
async function bill(data: Row) {
  await put("bills", data);
  return data;
}
export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { token?: string },
): Promise<T> {
  const method = init?.method ?? "GET",
    body = init?.body ? JSON.parse(String(init.body)) : {},
    url = new URL(path, "https://local.invalid"),
    parts = url.pathname.split("/").filter(Boolean);
  const now = new Date();
  if (path === "/v1/auth/login")
    return await tx(async () => {
      const user = (await all("users")).find(
        (u) => u.email === String(body.email).trim().toLowerCase() && u.active,
      );
      const attempts = (await all("settings")).find(
        (s) => s.id === "login-attempts",
      ) ?? { id: "login-attempts", failures: 0, until: 0 };
      if (attempts.until > Date.now())
        throw new Error("Too many attempts. Wait one minute and retry.");
      if (!user || !(await checkPassword(user, body.password))) {
        await put("settings", {
          ...attempts,
          failures: attempts.failures + 1,
          until: attempts.failures >= 4 ? Date.now() + 60000 : 0,
        });
        return { error: true };
      }
      await put("settings", { id: "login-attempts", failures: 0, until: 0 });
      const token = id();
      sessions.set(token, user.id);
      const business = (await all("settings")).find((s) => s.id === "business");
      await audit(user, "LOGIN", user.id);
      return {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          roles: [user.role],
          orgId: "local",
          orgName: business?.name ?? "Feeflow",
          profile: business?.industry ?? "SCHOOL",
          branchIds: ["main"],
        },
      };
    }).then((r) => {
      if ("error" in r) throw new ApiError("Invalid email or password.", 401);
      return r as T;
    });
  const user = await account(init?.token);
  const owner = () => {
    if (user.role !== "OWNER")
      throw new ApiError("Administrator access required.", 403);
  };
  const workspace = (await all("settings")).find(
    (row) => row.id === "business",
  );
  const industry = workspace?.industry ?? "SCHOOL";
  if (
    industry === "RESTAURANT" &&
    ["members", "groups", "reminders", "billing", "reminder-settings"].includes(
      parts[1],
    )
  )
    throw new ApiError("This workspace uses Quick Pay and transactions.", 403);
  const manage = () => {
    if (!["OWNER", "BRANCH_MANAGER"].includes(user.role))
      throw new ApiError("Owner or administrator access required.", 403);
  };
  if (
    (method === "GET" &&
      url.searchParams.get("lookup") !== "1" &&
      ["reminders", "transactions", "dashboard", "groups", "members"].includes(
        parts[1],
      )) ||
    (path === "/v1/quick-pay" && body.existingBillId) ||
    path === "/v1/reminders/resend" ||
    parts[3] === "verified-payment"
  )
    await runBilling(now);
  if (path === "/v1/auth/me")
    return { sub: user.id, roles: [user.role], branchIds: ["main"] } as T;
  if (path === "/v1/local/profile") {
    if (method === "GET") {
      const business = (await all("settings")).find(
        (row) => row.id === "business",
      );
      return {
        ...business,
        vpa: recipient(business),
        storage: business?.storage ?? "local",
      } as T;
    }
    owner();
    if (typeof body.vpa !== "string" || !validVpa(body.vpa))
      throw new Error("Enter a valid UPI address.");
    return tx(async () => {
      const business = (await all("settings")).find(
        (row) => row.id === "business",
      );
      const profile = {
        ...business,
        id: "business",
        paymentMode: "upi",
        vpa: body.vpa.trim(),
      };
      await put("settings", profile);
      await audit(user, "UPI_ADDRESS_CHANGED", profile.id);
      return profile as T;
    });
  }
  if (path === "/v1/local/school-fee" && method === "PUT") {
    manage();
    positive(body.feePaise);
    return tx(async () => {
      const school = (await all("settings")).find(
        (row) => row.id === "business",
      );
      if (!school || (school.industry ?? "SCHOOL") !== "SCHOOL")
        throw new Error("A standard tuition fee applies to schools.");
      if (
        (await all("members")).some(
          (member) =>
            member.status === "ACTIVE" &&
            body.feePaise + (member.hostelFeePaise ?? 0) > 50_000_000,
        )
      )
        throw new Error(
          "The new tuition and an existing hostel fee exceed ₹5,00,000.",
        );
      const settings = { ...school, standardFeePaise: body.feePaise };
      await put("settings", settings);
      await audit(user, "STANDARD_FEE_CHANGED", school.id);
      return settings as T;
    });
  }
  if (path === "/v1/billing/run" && method === "POST") {
    manage();
    return { issued: await runBilling() } as T;
  }
  if (method === "GET") {
    if (path === "/v1/reminder-settings")
      return (await reminderSettings()) as T;
    if (path === "/v1/reminders") {
      return { data: await reminders(now) } as T;
    }
    if (path === "/v1/local/staff") {
      owner();
      return {
        data: (await all("users")).map(({ id, name, email, role, active }) => ({
          id,
          name,
          email,
          role,
          active,
        })),
      } as T;
    }
    if (parts[1] === "branches") return { data: await all("branches") } as T;
    if (parts[1] === "members") {
      const members = await all("members");
      const query = (url.searchParams.get("q") ?? "").toLowerCase().trim();
      const matches = members.filter(
        (m) =>
          m.status === "ACTIVE" &&
          [
            m.name,
            m.externalRef,
            ...(m.guardians ?? []).map((g: Row) => g.phone),
          ].some((field) =>
            String(field ?? "")
              .toLowerCase()
              .includes(query),
          ),
      );
      if (!parts[2] && url.searchParams.get("lookup") === "1")
        return {
          data: matches
            .slice(0, 20)
            .map(({ id, name, externalRef }) => ({ id, name, externalRef })),
        } as T;
      const [bills, memberships] = await Promise.all([
        all("bills"),
        all("memberships"),
      ]);
      const memberByEnrollment = new Map(
        memberships.map((row) => [row.id, row.memberId]),
      );
      const byMember = new Map<string, BalanceBill[]>();
      for (const bill of bills) {
        const memberId =
          bill.memberId ?? memberByEnrollment.get(bill.membershipId);
        if (!memberId) continue;
        const rows = byMember.get(memberId) ?? [];
        rows.push({
          id: bill.id,
          purpose: bill.purpose,
          amountPaise: bill.amountPaise,
          paidPaise: bill.paidPaise,
          plannedTotalPaise: bill.plannedTotalPaise,
          status: bill.status,
        });
        byMember.set(memberId, rows);
      }
      const summary = (id: string) =>
        (byMember.get(id) ?? []).reduce(addBalance, emptyBalance());
      if (parts[2] && parts[3] === "balance") {
        const member = members.find((row) => row.id === parts[2]);
        if (!member) throw new ApiError("Member not found.", 404);
        return {
          name: member.name,
          totals: summary(member.id),
          bills: byMember.get(member.id) ?? [],
        } as T;
      }
      return {
        data: matches.map((member) => ({
          ...member,
          totals: summary(member.id),
        })),
      } as T;
    }
    if (parts[1] === "groups") {
      const groups = await all("groups");
      if (parts[2]) {
        const group = groups.find((g) => g.id === parts[2]);
        if (!group) throw new Error("Group not found.");
        const members = await all("members");
        const paidPeriods =
          group.feePlan?.mode === "SPORTS_RENEWAL" ? await all("bills") : [];
        return {
          ...group,
          reminderPolicies: group.reminderPolicies ?? defaultPolicies,
          nextBillDates: group.feePlan
            ? []
            : nextBillDates(
                {
                  ...group,
                  frequency: group.frequency,
                  endsAt: group.endsAt ? new Date(group.endsAt) : undefined,
                },
                3,
              ),
          memberships: (await all("memberships"))
            .filter((m) => m.groupId === group.id)
            .map((m) => {
              const paidThrough = paidPeriods
                .filter((bill) => bill.membershipId === m.id && bill.renewsOn)
                .reduce(
                  (latest, bill) =>
                    latest > bill.renewsOn ? latest : bill.renewsOn,
                  "",
                );
              return {
                ...m,
                member: members.find((x) => x.id === m.memberId),
                ...(group.feePlan?.mode === "SPORTS_RENEWAL"
                  ? {
                      paidThrough,
                      accessStatus:
                        !m.leftAt && paidThrough > localDate(now)
                          ? "ACTIVE"
                          : "PAUSED",
                    }
                  : {}),
              };
            }),
        } as T;
      }
      const memberships = await all("memberships");
      return {
        data: groups.map((group) => ({
          ...group,
          _count: {
            memberships: memberships.filter(
              (entry) => entry.groupId === group.id && !entry.leftAt,
            ).length,
          },
        })),
      } as T;
    }
    if (parts[1] === "transactions") {
      const [payments, branches, members, memberships] = await Promise.all([
        all("payments"),
        all("branches"),
        all("members"),
        all("memberships"),
      ]);
      const billId = url.searchParams.get("billId");
      return {
        data: (await all("bills"))
          .filter((row) => !billId || row.id === billId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((b) => ({
            ...b,
            branchName:
              branches.find((branch) => branch.id === b.branchId)?.name ?? "",
            memberName: members.find(
              (member) =>
                member.id ===
                (b.memberId ??
                  memberships.find((entry) => entry.id === b.membershipId)
                    ?.memberId),
            )?.name,
            payments: payments
              .filter((p) => p.billId === b.id)
              .map((p) => ({
                ...p,
                referenceMasked: "••••" + p.reference.slice(-4),
                source: "MANUAL_UPI",
              })),
          })),
      } as T;
    }
    if (parts[1] === "dashboard") {
      const allBills = await all("bills"),
        allPayments = await all("payments");
      const today = localDate(now);
      const bills =
        industry === "RESTAURANT"
          ? allBills.filter((b) => localDate(new Date(b.createdAt)) === today)
          : allBills;
      const payments =
        industry === "RESTAURANT"
          ? allPayments.filter(
              (p) =>
                localDate(new Date(p.receivedAt ?? p.confirmedAt)) === today,
            )
          : allPayments;
      return {
        grossConfirmedPaise: payments.reduce((s, p) => s + p.amountPaise, 0),
        outstandingPaise: bills
          .filter((b) => b.status !== "CANCELLED")
          .reduce((s, b) => s + b.amountPaise - b.paidPaise, 0),
        refundedPaise: 0,
        availablePaise: 0,
        heldPaise: 0,
        settledPaise: 0,
        dateBasis: "PAYMENT_CONFIRMED",
      } as T;
    }
    throw new Error(
      "This feature requires a payment provider and is unavailable in local mode.",
    );
  }
  return tx(async () => {
    const key = new Headers(init?.headers).get("Idempotency-Key"),
      fingerprint = JSON.stringify({ path, body });
    const saved = key && (await all("requests")).find((r) => r.id === key);
    if (saved) {
      if (saved.userId !== user.id || saved.fingerprint !== fingerprint)
        throw new Error("Retry key already used with different details.");
      return saved.result;
    }
    let result: any;
    if (path === "/v1/local/staff" && method === "POST") {
      owner();
      if (!(await checkPassword(user, String(body.ownerPassword ?? ""))))
        throw new Error("Administrator password is incorrect.");
      await createUser(
        String(body.email ?? "").trim(),
        String(body.name ?? ""),
        String(body.password ?? ""),
        body.role === "BRANCH_MANAGER" ? "BRANCH_MANAGER" : "COLLECTOR",
      );
      await audit(
        user,
        "STAFF_CREATED",
        String(body.email).trim().toLowerCase(),
      );
      result = { ok: true };
    } else if (path === "/v1/reminder-settings" && method === "PUT") {
      owner();
      const {
        reminderStartHour: start,
        reminderEndHour: end,
        reminderDailyCap: cap,
      } = body;
      if (
        ![start, end, cap].every(Number.isInteger) ||
        start < 0 ||
        end > 24 ||
        start >= end ||
        cap < 1 ||
        cap > 10
      )
        throw new Error("Enter a valid IST sending window and daily cap.");
      result = {
        id: "reminder-settings",
        reminderStartHour: start,
        reminderEndHour: end,
        reminderDailyCap: cap,
      };
      await put("settings", result);
    } else if (path === "/v1/reminders/resend") {
      const entry = (await reminders(now)).find(
        (row) => row.id === body.occurrenceId,
      );
      if (!entry || !["READY", "OPENED"].includes(entry.status))
        throw new Error("This reminder is currently ineligible.");
      const history = (await all("settings")).filter((row) =>
        row.id.startsWith("reminder-handoff:"),
      );
      const settings = await reminderSettings();
      if (
        history.filter(
          (row) =>
            row.phone?.slice(-10) === entry.phone.slice(-10) &&
            Date.parse(row.at) > now.getTime() - 86_400_000,
        ).length >= settings.reminderDailyCap
      )
        throw new Error("The recipient has reached the daily reminder limit.");
      const business = (await all("settings")).find(
        (row) => row.id === "business",
      );
      const balance = entry.bill.amountPaise - entry.bill.paidPaise;
      const intent = upiUrl(recipient(business), business?.name ?? "Feeflow", {
        id: entry.bill.id,
        amountPaise: balance,
        purpose: entry.bill.purpose,
      });
      await put("settings", {
        id: "reminder-handoff:" + id(),
        occurrenceId: entry.id,
        phone: entry.phone,
        at: now.toISOString(),
      });
      result = {
        whatsappUrl: whatsappPayment(
          entry.phone,
          intent,
          entry.bill.purpose,
          balance,
          body.webOrigin,
          entry.language,
          "breakdown" in entry && entry.breakdown ? entry.breakdown : undefined,
        ),
      };
    } else if (path === "/v1/quick-pay") {
      positive(body.amountPaise);
      if (!body.purpose?.trim()) throw new Error("Purpose is required.");
      if (
        body.deliveryChannel &&
        (body.deliveryChannel !== "WHATSAPP" ||
          body.deliveryConsent !== true ||
          !indianMobile.test(body.recipientPhone ?? ""))
      )
        throw new Error(
          "WhatsApp requires a valid mobile number and recipient permission.",
        );
      const business = (await all("settings")).find(
        (row) => row.id === "business",
      );
      const member =
        body.memberId &&
        (await all("members")).find(
          (row) => row.id === body.memberId && row.status === "ACTIVE",
        );
      if (body.memberId && !member)
        throw new ApiError("Choose an active member.", 404);
      const existing =
        body.existingBillId &&
        (await all("bills")).find((row) => row.id === body.existingBillId);
      if (body.existingBillId) {
        const enrollment =
          existing?.membershipId &&
          (await all("memberships")).find(
            (row) => row.id === existing.membershipId,
          );
        if (
          !member ||
          !existing ||
          (existing.memberId ?? enrollment?.memberId) !== member.id ||
          !payable(existing as BalanceBill) ||
          body.amountPaise > remaining(existing as BalanceBill)
        )
          throw new Error(
            "Choose a payable charge for this member and an amount within its balance.",
          );
      }
      const billId = existing?.id ?? id();
      const qr = upiUrl(recipient(business), business?.name ?? "Feeflow", {
        amountPaise: body.amountPaise,
        purpose: body.purpose.trim(),
        id: billId,
      });
      const b =
        existing ||
        (await bill({
          id: billId,
          ...(member ? { memberId: member.id } : {}),
          upiIntentUrl: qr,
          branchId: "main",
          purpose: body.purpose,
          amountPaise: body.amountPaise,
          paidPaise: 0,
          status: "ISSUED",
          createdAt: now.toISOString(),
        }));
      result = {
        billId: b.id,
        paymentLinkToken: b.id,
        checkoutUrl: sharePaymentLink(qr, body.webOrigin),
        upiIntentUrl: qr,
        ...(body.deliveryChannel === "WHATSAPP"
          ? {
              whatsappUrl: whatsappPayment(
                body.recipientPhone,
                qr,
                body.purpose.trim(),
                body.amountPaise,
                body.webOrigin,
              ),
            }
          : {}),
      };
      await audit(
        user,
        existing ? "PAYMENT_REQUEST_CREATED" : "BILL_CREATED",
        b.id,
      );
    } else if (parts[0] === "pay" && parts[2] === "checkout") {
      const b = (await all("bills")).find((b) => b.id === parts[1]);
      if (!b || b.paidPaise >= b.amountPaise)
        throw new Error("No payable balance.");
      const business = (await all("settings")).find(
        (row) => row.id === "business",
      );
      const original = b.upiIntentUrl && new URL(b.upiIntentUrl);
      result = {
        upiIntentUrl: upiUrl(
          original ? original.searchParams.get("pa") : recipient(business),
          original
            ? original.searchParams.get("pn")
            : (business?.name ?? "Feeflow"),
          {
            id: b.id,
            amountPaise: b.amountPaise - b.paidPaise,
            purpose: b.purpose,
          },
        ),
      };
    } else if (parts[1] === "members") {
      if (
        parts[2] === "import" ||
        parts[3] === "archive" ||
        parts[3] === "fees"
      )
        manage();
      if (parts[2] === "import") {
        if (typeof body.csv !== "string" || body.csv.length > 500000)
          throw new Error("Choose a CSV up to 500 KB.");
        const rows = memberCsv(body.csv);
        const existing = await all("members");
        for (const row of rows)
          if (existing.some((member) => member.externalRef === row.externalRef))
            row.errors.push("Reference already exists");
        if (body.confirm && rows.some((row) => row.errors.length))
          throw new Error("Correct the CSV errors before importing.");
        if (body.confirm)
          for (const row of rows)
            await put(
              "members",
              newMember(
                row.name,
                row.externalRef,
                row.phone ? [{ name: row.guardianName, phone: row.phone }] : [],
              ),
            );
        result = { rows, imported: body.confirm ? rows.length : 0 };
      } else if (parts[3] === "guardians" && parts[5] === "whatsapp-consent") {
        const member = (await all("members")).find(
          (m) => m.id === parts[2] && m.status === "ACTIVE",
        );
        const guardian = member?.guardians?.find((g: Row) => g.id === parts[4]);
        if (!member || !guardian) throw new Error("Guardian not found.");
        if (
          typeof body.optIn !== "boolean" ||
          typeof body.evidence !== "string" ||
          body.evidence.trim().length < 3
        )
          throw new Error("Enter consent evidence.");
        const contact = {
          ...guardian,
          optOut: !body.optIn,
          whatsappConsentedAt: body.optIn ? now.toISOString() : null,
          consentEvidence: body.evidence.trim(),
        };
        result = {
          ...member,
          guardians: member.guardians.map((g: Row) =>
            g.id === contact.id ? contact : g,
          ),
        };
        await put("members", result);
      } else if (parts[3] === "fees" && method === "PUT") {
        const member = (await all("members")).find(
          (row) => row.id === parts[2] && row.status === "ACTIVE",
        );
        if (!member) throw new Error("Member not found.");
        if (
          !Number.isInteger(body.concessionPercent) ||
          body.concessionPercent < 0 ||
          body.concessionPercent > 100
        )
          throw new Error(
            "Concession must be a whole percentage between 0 and 100.",
          );
        const business = (await all("settings")).find(
          (row) => row.id === "business",
        );
        if (business?.industry === "RESTAURANT")
          throw new Error(
            "Concessions are available for school and sports workspaces.",
          );
        result = { ...member, concessionPercent: body.concessionPercent };
        await put("members", result);
        const memberships = await all("memberships");
        for (const bill of await all("bills")) {
          if (
            (bill.memberId ??
              memberships.find((row) => row.id === bill.membershipId)
                ?.memberId) !== member.id ||
            !bill.membershipId ||
            bill.planned ||
            !["ISSUED", "PARTIAL", "WAIVED"].includes(bill.status)
          )
            continue;
          const baseFeePaise = bill.baseFeePaise ?? bill.amountPaise;
          const amountPaise = Math.max(
            bill.paidPaise,
            discountedFee(
              baseFeePaise,
              bill.hostelFeePaise ?? 0,
              body.concessionPercent,
            ),
          );
          await put("bills", {
            ...bill,
            baseFeePaise,
            amountPaise,
            concessionPercent: body.concessionPercent,
            status: !amountPaise
              ? "WAIVED"
              : amountPaise === bill.paidPaise
                ? "PAID"
                : bill.paidPaise
                  ? "PARTIAL"
                  : "ISSUED",
          });
        }
      } else if (parts[3] === "archive") {
        const m = (await all("members")).find((m) => m.id === parts[2]);
        if (!m) throw new Error("Member not found.");
        result = { ...m, status: "ARCHIVED" };
        await put("members", result);
      } else {
        if (!body.name?.trim()) throw new Error("Name is required.");
        if (
          body.externalRef &&
          (await all("members")).some((m) => m.externalRef === body.externalRef)
        )
          throw new Error("Reference already exists.");
        if (parts[2] || method !== "POST")
          throw new Error("Member operation is unavailable.");
        const business = (await all("settings")).find(
          (row) => row.id === "business",
        );
        result = newMember(body.name, body.externalRef, body.guardians ?? []);
        if ((business?.industry ?? "SCHOOL") === "SCHOOL") {
          const feePaise = business?.standardFeePaise ?? body.feePaise;
          if (feePaise != null) positive(feePaise);
          if (body.hostelFeePaise != null && body.hostelFeePaise !== 0)
            positive(body.hostelFeePaise);
          if ((feePaise ?? 0) + (body.hostelFeePaise ?? 0) > 50_000_000)
            throw new Error("Combined fees cannot exceed ₹5,00,000.");
          result = {
            ...result,
            feePaise: feePaise ?? null,
            hostelFeePaise: body.hostelFeePaise ?? 0,
            concessionPercent: 0,
          };
        }
        await put("members", result);
        if (body.groupId) {
          const group = (await all("groups")).find(
            (row) => row.id === body.groupId && row.isActive && row.feePlan,
          );
          if (!group)
            throw new Error("Choose an active class or sports program.");
          await put("memberships", {
            id: id(),
            memberId: result.id,
            groupId: group.id,
            joinedAt: now.toISOString(),
            leftAt: null,
            ...enrollmentFields(group, body, localDate(now)),
          });
        }
      }
      if (result.id || result.imported)
        await audit(user, "MEMBER_CHANGED", result.id ?? "import");
    } else if (parts[1] === "groups") {
      if (parts[3] !== "members" || method !== "POST") manage();
      if (["preview", undefined].includes(parts[2])) {
        if (
          !["MONTHLY", "QUARTERLY", "YEARLY"].includes(
            body.frequency ?? "MONTHLY",
          )
        )
          throw new Error("Choose monthly, quarterly, or yearly billing.");
        if (
          !Number.isInteger(body.dueDayOffset ?? 7) ||
          (body.dueDayOffset ?? 7) < 0 ||
          (body.dueDayOffset ?? 7) > 60
        )
          throw new Error("Enter a valid due date offset.");
      }
      if (body.feePlan && ["preview", undefined].includes(parts[2])) {
        positive(body.amountPaise);
        const feePlan = readFeePlan(body.feePlan, industry, body.amountPaise);
        if (
          !body.name?.trim() ||
          !(await all("branches")).some((row) => row.id === body.branchId)
        )
          throw new Error("Choose a class or program name and branch.");
        if (parts[2] === "preview") {
          const startsOn =
            feePlan.mode === "SCHOOL" ? feePlan.startsOn : localDate(now);
          const example = feeSchedule(
            { id: "preview", feePlan, amountPaise: body.amountPaise },
            {
              id: "preview",
              paymentPlan:
                feePlan.mode === "SPORTS_RENEWAL" ? "FULL" : "MONTHLY",
              joinedAt: now.toISOString(),
            },
            0,
            startsOn,
          );
          const dates = new Map<string, number>();
          for (const entry of example.entries)
            dates.set(
              entry.dueOn,
              (dates.get(entry.dueOn) ?? 0) + entry.amountPaise,
            );
          result = {
            cycles: [...dates.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .slice(0, 3)
              .map(([date, amountPaise]) => ({
                issueDate: date,
                dueDate: date,
                amountPaise,
                reminders: [date],
              })),
          };
        } else {
          result = {
            id: id(),
            name: body.name.trim(),
            branchId: body.branchId,
            feePlan,
            amountPaise: body.amountPaise,
            frequency: "MONTHLY",
            billDayOfMonth: 1,
            isActive: true,
            createdAt: now.toISOString(),
          };
          await put("groups", result);
        }
      } else if (parts[2] === "preview") {
        positive(body.amountPaise);
        if (
          body.billDayOfMonth !== null &&
          (!Number.isInteger(body.billDayOfMonth) ||
            body.billDayOfMonth < 1 ||
            body.billDayOfMonth > 31)
        )
          throw new Error("Issue day must be 1–31.");
        result = {
          cycles: nextBillDates(
            {
              ...body,
              frequency: body.frequency ?? "MONTHLY",
              endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
            },
            3,
          ).map((d) => {
            const dueDate = addDays(d, body.dueDayOffset ?? 7);
            return {
              issueDate: d,
              dueDate,
              amountPaise: body.amountPaise,
              reminders: defaultPolicies.map((policy) =>
                addDays(dueDate, policy.offsetDays),
              ),
            };
          }),
        };
      } else if (!parts[2]) {
        positive(body.amountPaise);
        result = {
          ...body,
          id: id(),
          frequency: body.frequency ?? "MONTHLY",
          isActive: true,
          billingActivity: [{ at: now.toISOString(), active: true }],
          createdAt: now.toISOString(),
        };
        await put("groups", result);
      } else if (parts[3] === "reminders") {
        const group = (await all("groups")).find((g) => g.id === parts[2]);
        if (!group) throw new Error("Group not found.");
        if (
          !Array.isArray(body) ||
          body.length > 10 ||
          new Set(body.map((p) => p.offsetDays)).size !== body.length ||
          body.some(
            (p) =>
              !Number.isInteger(p.offsetDays) ||
              Math.abs(p.offsetDays) > 30 ||
              !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.sendTimeIST) ||
              !["en", "hi"].includes(p.language) ||
              !Array.isArray(p.channels) ||
              !p.channels.includes("WHATSAPP"),
          )
        )
          throw new Error(
            "Choose unique reminder days, a valid time, and WhatsApp delivery.",
          );
        result = {
          ...group,
          reminderPolicies: body.map((policy) => ({
            ...policy,
            channels: ["WHATSAPP"],
            isActive: true,
          })),
        };
        await put("groups", result);
      } else if (parts[3] === "members") {
        const memberships = await all("memberships");
        const schoolGroups = new Map(
          (await all("groups"))
            .filter((row) => row.feePlan?.mode === "SCHOOL")
            .map((row) => [row.id, row]),
        );
        const history = memberships.filter(
          (m) =>
            m.groupId === parts[2] &&
            m.memberId === (parts[4] ?? body.memberId),
        );
        const old = history.find((m) => !m.leftAt) ?? history[0];
        if (method === "DELETE") {
          if (!old) throw new Error("Membership not found.");
          result = { ...old, leftAt: old.leftAt ?? now.toISOString() };
        } else {
          const g = (await all("groups")).find((g) => g.id === parts[2]);
          if (
            !g?.isActive ||
            !(await all("members")).some(
              (m) => m.id === body.memberId && m.status === "ACTIVE",
            )
          )
            throw new Error("Active group/member required.");
          if (old && (!old.leftAt || g.feePlan?.mode === "SCHOOL"))
            throw new Error("Member is already enrolled.");
          if (!g.feePlan) manage();
          if (body.amountPaise != null) {
            if (g.feePlan)
              throw new Error(
                "Class and program fees are set by administrators.",
              );
            positive(body.amountPaise);
          }
          if (
            g.feePlan?.mode === "SCHOOL" &&
            memberships.some(
              (row) =>
                row.id !== old?.id &&
                row.memberId === body.memberId &&
                (() => {
                  const otherStart = schoolGroups.get(row.groupId)?.feePlan
                    ?.startsOn;
                  return (
                    otherStart &&
                    otherStart < addMonths(g.feePlan.startsOn, 12) &&
                    g.feePlan.startsOn < addMonths(otherStart, 12)
                  );
                })(),
            )
          )
            throw new Error(
              "This student already belongs to a class for this academic year.",
            );
          result = {
            amountPaise: body.amountPaise ?? null,
            id: g.feePlan ? id() : (old?.id ?? id()),
            groupId: parts[2],
            memberId: body.memberId,
            joinedAt: now.toISOString(),
            leftAt: null,
            ...(g.feePlan ? enrollmentFields(g, body, localDate(now)) : {}),
          };
        }
        await put("memberships", result);
      } else {
        const g = (await all("groups")).find((g) => g.id === parts[2]);
        if (!g) throw new Error("Group not found.");
        if (typeof body.isActive !== "boolean")
          throw new Error("Choose whether billing is active.");
        result = {
          ...g,
          isActive: body.isActive,
          billingActivity: [
            ...(g.billingActivity ?? [{ at: g.createdAt, active: g.isActive }]),
            { at: now.toISOString(), active: body.isActive },
          ],
        };
        await put("groups", result);
      }
      await audit(user, "GROUP_CHANGED", result.id ?? parts[2]);
    } else if (parts[1] === "transactions" && parts[3] === "verified-payment") {
      if (industry !== "RESTAURANT") owner();
      positive(body.amountPaise);
      if (
        body.verified !== true ||
        !["UPI_APP", "BANK_STATEMENT"].includes(body.verificationMethod)
      )
        throw new Error("Verify the receiving account first.");
      const reference = String(body.reference).trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9-]{5,63}$/.test(reference))
        throw new Error("Enter a valid bank reference.");
      const receivedAt = new Date(body.receivedAt);
      if (
        !Number.isFinite(receivedAt.getTime()) ||
        receivedAt.getTime() > Date.now() + 60000
      )
        throw new Error("Invalid or future receipt time.");
      const b = (await all("bills")).find((b) => b.id === parts[2]);
      if (!b) throw new Error("Bill not found.");
      const prior = (await all("payments")).find(
        (p) => p.reference === reference,
      );
      if (prior) {
        if (prior.billId !== b.id || prior.amountPaise !== body.amountPaise)
          throw new Error("Reference already recorded for another payment.");
        return {
          receiptNo: prior.receiptNo,
          remainingPaise: b.amountPaise - b.paidPaise,
          replayed: true,
        } as T;
      }
      if (
        (b.planned
          ? b.status === "CANCELLED"
          : !["ISSUED", "PARTIAL", "EXPIRED"].includes(b.status)) ||
        body.amountPaise >
          (b.planned
            ? Math.max(b.plannedTotalPaise, b.amountPaise)
            : b.amountPaise) -
            b.paidPaise
      )
        throw new Error("Amount exceeds payable balance.");
      const p = {
        id: id(),
        billId: b.id,
        amountPaise: body.amountPaise,
        reference,
        receivedAt: receivedAt.toISOString(),
        recordedBy: user.id,
        receiptNo: "FF-" + id().replace(/-/g, "").toUpperCase(),
        note: body.note,
        confirmedAt: now.toISOString(),
      };
      await put("payments", p);
      await put("receipts", { id: p.receiptNo, paymentId: p.id, billId: b.id });
      await put("ledger", {
        id: id(),
        billId: b.id,
        paymentId: p.id,
        type: "PAYMENT",
        amountPaise: p.amountPaise,
      });
      const paid = b.paidPaise + p.amountPaise;
      const accrued = Math.max(paid, b.amountPaise);
      await put("bills", {
        ...b,
        paidPaise: paid,
        amountPaise: accrued,
        ...(b.planned ? { paidOn: localDate(receivedAt) } : {}),
        status: paid === accrued ? "PAID" : "PARTIAL",
      });
      await audit(user, "PAYMENT_VERIFIED", p.id);
      result = {
        receiptNo: p.receiptNo,
        remainingPaise: accrued - paid,
        replayed: false,
      };
    } else throw new Error("Not available in single-device mode.");
    if (key)
      await put("requests", { id: key, userId: user.id, fingerprint, result });
    return result as T;
  });
}
function recipient(business?: Row) {
  return business?.paymentMode === "upi" ? (business.vpa ?? "") : "";
}

export async function runBilling(now = new Date()) {
  return tx(async () => {
    let issued = 0;
    const today = localDate(now);
    const monthIndex = (date: string) =>
      Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
    const [bills, members, memberships, groups, settings] = await Promise.all([
      all("bills"),
      all("members"),
      all("memberships"),
      all("groups"),
      all("settings"),
    ]);
    if (
      settings.find((row) => row.id === "business")?.industry === "RESTAURANT"
    )
      return 0;
    const standardFee = settings.find(
      (row) => row.id === "business",
    )?.standardFeePaise;
    const issuedPeriods = new Set(
      bills.map((record) => record.membershipId + ":" + record.billingPeriod),
    );
    const activeMembers = new Map(
      members
        .filter((member) => member.status === "ACTIVE")
        .map((member) => [member.id, member]),
    );
    for (const group of groups) {
      if (group.feePlan) {
        for (const enrollment of memberships.filter(
          (row) => row.groupId === group.id,
        )) {
          const student = members.find((row) => row.id === enrollment.memberId);
          if (!student) continue;
          const previous = bills
            .filter((row) => row.membershipId === enrollment.id && row.planned)
            .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
          for (const planned of plannedBills(
            group,
            enrollment,
            student,
            previous,
            today,
          )) {
            const prior = previous.find((row) => row.id === planned.id);
            if (JSON.stringify(prior) === JSON.stringify(planned)) continue;
            await bill(planned);
            if (!prior || prior.amountPaise < planned.amountPaise) issued++;
          }
        }
        continue;
      }
      if (!group.isActive && !group.billingActivity) continue;
      const eligible = memberships.filter(
        (membership) =>
          membership.groupId === group.id &&
          activeMembers.has(membership.memberId),
      );
      for (
        let month = monthIndex(localDate(new Date(group.createdAt)));
        month <= monthIndex(today);
        month += billingInterval(group.frequency)
      ) {
        const issue = cycleDate(
          Math.floor(month / 12),
          month % 12,
          group.billDayOfMonth,
        );
        const issueAt = istInstant(issue);
        if (
          issueAt > now ||
          issueAt < new Date(group.createdAt) ||
          (group.endsAt && issueAt > new Date(group.endsAt))
        )
          continue;
        if (
          group.billingActivity &&
          ![...group.billingActivity]
            .reverse()
            .find((entry) => new Date(entry.at) <= issueAt)?.active
        )
          continue;
        const period = issue.slice(0, 7);
        for (const membership of eligible) {
          if (
            new Date(membership.joinedAt) > issueAt ||
            (membership.leftAt && new Date(membership.leftAt) <= issueAt)
          )
            continue;
          const key = membership.id + ":" + period;
          if (issuedPeriods.has(key)) continue;
          const member = activeMembers.get(membership.memberId)!;
          const baseFeePaise =
            standardFee ??
            member.feePaise ??
            membership.amountPaise ??
            group.amountPaise;
          const hostelFeePaise = member.hostelFeePaise ?? 0;
          const concessionPercent = member.concessionPercent ?? 0;
          const amountPaise = discountedFee(
            baseFeePaise,
            hostelFeePaise,
            concessionPercent,
          );
          await bill({
            id: membership.id + "-" + period,
            branchId: group.branchId ?? "main",
            membershipId: membership.id,
            billingPeriod: period,
            purpose: group.name + " · " + period,
            memberId: membership.memberId,
            groupId: group.id,
            dueDate: addDays(issue, group.dueDayOffset ?? 7),
            baseFeePaise,
            hostelFeePaise,
            concessionPercent,
            amountPaise,
            paidPaise: 0,
            status: amountPaise ? "ISSUED" : "WAIVED",
            createdAt: issueAt.toISOString(),
          });
          issuedPeriods.add(key);
          issued++;
        }
      }
    }
    return issued;
  });
}

function newMember(
  name: string,
  externalRef: string | undefined,
  guardians: { name: string; phone: string }[],
) {
  return {
    id: id(),
    name: name.trim(),
    externalRef,
    status: "ACTIVE",
    guardians: guardians.map((guardian) => {
      if (!guardian.name.trim() || !indianMobile.test(guardian.phone))
        throw new Error(
          "Enter a guardian name and valid Indian mobile number.",
        );
      return {
        ...guardian,
        id: id(),
        whatsappConsentedAt: null,
        optOut: false,
      };
    }),
  };
}

const defaultPolicies = [-3, 0, 3].map((offsetDays) => ({
  offsetDays,
  sendTimeIST: "10:00",
  language: "en",
  channels: ["WHATSAPP"],
  isActive: true,
}));

async function reminderSettings() {
  return (
    (await all("settings")).find((row) => row.id === "reminder-settings") ?? {
      reminderStartHour: 8,
      reminderEndHour: 20,
      reminderDailyCap: 3,
    }
  );
}

async function reminders(now: Date) {
  const [bills, members, groups, memberships, settings, limits] =
    await Promise.all([
      all("bills"),
      all("members"),
      all("groups"),
      all("memberships"),
      all("settings"),
      reminderSettings(),
    ]);
  const istHour = new Date(now.getTime() + 330 * 60000).getUTCHours();
  return bills
    .flatMap((bill) => {
      const membership = memberships.find(
        (entry) => entry.id === bill.membershipId,
      );
      const group = groups.find(
        (entry) => entry.id === (bill.groupId ?? membership?.groupId),
      );
      const member = members.find(
        (entry) => entry.id === (bill.memberId ?? membership?.memberId),
      );
      if (!group || !member) return [];
      if (bill.planned) {
        const plan = group.feePlan as FeePlan;
        const today = localDate(now);
        const reminderDate =
          plan.mode === "SPORTS_RENEWAL"
            ? today < bill.startsOn
              ? addDays(bill.startsOn, -7)
              : bill.startsOn
            : today.slice(0, 7) + "-01";
        const scheduledAt = istInstant(reminderDate, "08:00").toISOString();
        const due = bill.amountPaise - bill.paidPaise;
        if (due <= 0) return [];
        const newlyDue = (
          (bill.schedule as { dueOn: string; amountPaise: number }[]) ?? []
        )
          .filter(
            (row) =>
              row.dueOn <= today && row.dueOn.slice(0, 7) === today.slice(0, 7),
          )
          .reduce((sum, row) => sum + row.amountPaise, 0);
        const previous = Math.max(
          0,
          due -
            (today < bill.startsOn && plan.mode === "SPORTS_RENEWAL"
              ? due
              : newlyDue),
        );
        return (member.guardians ?? [])
          .filter((guardian: Row) => guardian.id)
          .map((guardian: Row) => {
            const id = [bill.id, guardian.id, reminderDate].join(":");
            const consent =
              member.status === "ACTIVE" &&
              guardian.whatsappConsentedAt &&
              !guardian.optOut &&
              indianMobile.test(guardian.phone);
            const ready =
              Date.parse(scheduledAt) <= now.getTime() &&
              istHour >= limits.reminderStartHour &&
              istHour < limits.reminderEndHour;
            return {
              id,
              bill: { ...bill, memberId: member.id },
              phone: guardian.phone,
              scheduledAt,
              language: "en",
              channel: "WHATSAPP",
              breakdown: {
                previous,
                newlyDue: due - previous,
                paid: bill.paidPaise,
              },
              status: !consent
                ? "SUPPRESSED"
                : !ready
                  ? "QUEUED"
                  : settings.some((row) => row.occurrenceId === id)
                    ? "OPENED"
                    : "READY",
              failureReason: consent ? null : "WhatsApp permission required",
            };
          });
      }
      const due =
        bill.dueDate ??
        addDays(
          cycleDate(
            Number(bill.billingPeriod.slice(0, 4)),
            Number(bill.billingPeriod.slice(5, 7)) - 1,
            group.billDayOfMonth,
          ),
          group.dueDayOffset ?? 7,
        );
      return (group.reminderPolicies ?? defaultPolicies)
        .filter((policy: (typeof defaultPolicies)[number]) => policy.isActive)
        .flatMap((policy: (typeof defaultPolicies)[number]) =>
          (member.guardians ?? [])
            .filter((guardian: Row) => guardian.id)
            .map((guardian: Row) => {
              const scheduledAt = new Date(
                addDays(due, policy.offsetDays) +
                  "T" +
                  policy.sendTimeIST +
                  ":00+05:30",
              ).toISOString();
              const occurrenceId = [bill.id, guardian.id, scheduledAt].join(
                ":",
              );
              const opened = settings.some(
                (entry) => entry.occurrenceId === occurrenceId,
              );
              const payable =
                member.status === "ACTIVE" &&
                group.isActive &&
                ["ISSUED", "PARTIAL"].includes(bill.status);
              const eligible =
                payable &&
                guardian.whatsappConsentedAt &&
                !guardian.optOut &&
                indianMobile.test(guardian.phone);
              const ready =
                Date.parse(scheduledAt) <= now.getTime() &&
                istHour >= limits.reminderStartHour &&
                istHour < limits.reminderEndHour;
              return {
                id: occurrenceId,
                bill: { ...bill, memberId: member.id },
                phone: guardian.phone,
                scheduledAt,
                language: policy.language,
                channel: "WHATSAPP",
                status: !eligible
                  ? "SUPPRESSED"
                  : ready
                    ? opened
                      ? "OPENED"
                      : "READY"
                    : "QUEUED",
                failureReason: !payable
                  ? "Bill or enrollment is no longer active"
                  : !eligible
                    ? "WhatsApp permission required"
                    : null,
              };
            }),
        );
    })
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
    .slice(0, 100);
}

function discountedFee(
  baseFeePaise: number,
  hostelFeePaise: number,
  concession: number,
) {
  return Math.round((baseFeePaise * (100 - concession)) / 100) + hostelFeePaise;
}
