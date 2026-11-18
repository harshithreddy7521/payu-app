import { all, put, tx, id, randomBytes } from "./repository";
import { hex, passwordKey, sameSecret } from "./crypto";
import { Row } from "./schema";
import {
  nextBillDates,
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
    !["OWNER", "COLLECTOR"].includes(role)
  )
    throw new Error(
      "Enter a valid name/email and a password of at least 10 characters.",
    );
  if ((await all("users")).some((u) => u.email === email.toLowerCase().trim()))
    throw new Error("An account with this email exists.");
  const salt = hex(randomBytes(16)),
    key = await passwordKey(password, salt);
  try {
    await put("users", {
      id: id(),
      email: email.toLowerCase().trim(),
      name: name.trim(),
      role,
      salt,
      hash: hex(key),
      active: true,
    });
  } finally {
    key.fill(0);
  }
}
export async function setup(
  name: string,
  email: string,
  password: string,
  business: string,
) {
  await tx(async () => {
    if ((await all("users")).length)
      throw new Error("This device is already configured.");
    await createUser(email, name, password);
    await put("settings", {
      id: "business",
      name: business.trim() || "My business",
      vpa: "7090832433@ybl",
    });
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
          profile: "SCHOOL",
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
  if (path === "/v1/auth/me")
    return { sub: user.id, roles: [user.role], branchIds: ["main"] } as T;
  if (method === "GET") {
    if (parts[1] === "branches") return { data: await all("branches") } as T;
    if (parts[1] === "members")
      return {
        data: (await all("members")).filter((m) => m.status === "ACTIVE"),
      } as T;
    if (parts[1] === "groups") {
      const groups = await all("groups");
      if (parts[2]) {
        const group = groups.find((g) => g.id === parts[2]);
        if (!group) throw new Error("Group not found.");
        const members = await all("members");
        return {
          ...group,
          nextBillDates: nextBillDates(group as any, 3),
          memberships: (await all("memberships"))
            .filter((m) => m.groupId === group.id)
            .map((m) => ({
              ...m,
              member: members.find((x) => x.id === m.memberId),
            })),
        } as T;
      }
      return { data: groups } as T;
    }
    if (parts[1] === "transactions") {
      const payments = await all("payments");
      return {
        data: (await all("bills"))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((b) => ({
            ...b,
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
      const bills = await all("bills"),
        payments = await all("payments");
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
    if (path === "/v1/quick-pay") {
      positive(body.amountPaise);
      if (!body.purpose?.trim()) throw new Error("Purpose is required.");
      const b = await bill({
        id: id(),
        branchId: "main",
        purpose: body.purpose,
        amountPaise: body.amountPaise,
        paidPaise: 0,
        status: "ISSUED",
        createdAt: now.toISOString(),
      });
      result = {
        billId: b.id,
        paymentLinkToken: b.id,
        checkoutUrl: upi(b),
        upiIntentUrl: upi(b),
      };
      await audit(user, "BILL_CREATED", b.id);
    } else if (parts[0] === "pay" && parts[2] === "checkout") {
      const b = (await all("bills")).find((b) => b.id === parts[1]);
      if (!b || b.paidPaise >= b.amountPaise)
        throw new Error("No payable balance.");
      result = { upiIntentUrl: upi(b) };
    } else if (parts[1] === "members") {
      owner();
      if (parts[3] === "archive") {
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
        result = { ...body, id: id(), status: "ACTIVE" };
        await put("members", result);
      }
      await audit(user, "MEMBER_CHANGED", result.id);
    } else if (parts[1] === "groups") {
      owner();
      if (parts[2] === "preview") {
        positive(body.amountPaise);
        if (
          body.billDayOfMonth !== null &&
          (!Number.isInteger(body.billDayOfMonth) ||
            body.billDayOfMonth < 1 ||
            body.billDayOfMonth > 31)
        )
          throw new Error("Issue day must be 1–31.");
        result = {
          cycles: nextBillDates({ ...body, frequency: "MONTHLY" }, 3).map(
            (d) => ({ issueDate: d, dueDate: addDays(d, 7) }),
          ),
        };
      } else if (!parts[2]) {
        positive(body.amountPaise);
        result = {
          ...body,
          id: id(),
          frequency: "MONTHLY",
          isActive: true,
          createdAt: now.toISOString(),
        };
        await put("groups", result);
      } else if (parts[3] === "members") {
        const memberships = await all("memberships");
        const old = memberships.find(
          (m) =>
            m.groupId === parts[2] &&
            m.memberId === (parts[4] ?? body.memberId),
        );
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
          if (old && !old.leftAt)
            throw new Error("Member is already enrolled.");
          result = {
            id: old?.id ?? id(),
            groupId: parts[2],
            memberId: body.memberId,
            joinedAt: now.toISOString(),
            leftAt: null,
          };
        }
        await put("memberships", result);
      } else {
        const g = (await all("groups")).find((g) => g.id === parts[2]);
        if (!g) throw new Error("Group not found.");
        result = { ...g, isActive: !!body.isActive };
        await put("groups", result);
      }
      await audit(user, "GROUP_CHANGED", result.id ?? parts[2]);
    } else if (parts[1] === "transactions" && parts[3] === "verified-payment") {
      owner();
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
        return { receiptNo: prior.receiptNo };
      }
      if (
        !["ISSUED", "PARTIAL", "EXPIRED"].includes(b.status) ||
        body.amountPaise > b.amountPaise - b.paidPaise
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
      await put("bills", {
        ...b,
        paidPaise: paid,
        status: paid === b.amountPaise ? "PAID" : "PARTIAL",
      });
      await audit(user, "PAYMENT_VERIFIED", p.id);
      result = { receiptNo: p.receiptNo };
    } else throw new Error("Not available in single-device mode.");
    if (key)
      await put("requests", { id: key, userId: user.id, fingerprint, result });
    return result as T;
  });
}
function upi(b: Row) {
  return (
    "upi://pay?" +
    new URLSearchParams({
      pa: "7090832433@ybl",
      pn: "UPI recipient",
      am: ((b.amountPaise - b.paidPaise) / 100).toFixed(2),
      cu: "INR",
      tn: b.purpose.slice(0, 80),
      tr: b.id.replace(/-/g, ""),
    })
  );
}
export async function runBilling() {
  await tx(async () => {
    const now = new Date(),
      today = localDate(now);
    const existing = await all("bills"),
      members = await all("members"),
      memberships = await all("memberships");
    for (const g of await all("groups")) {
      if (!g.isActive) continue;
      const [y, m] = today.split("-").map(Number);
      const issue = cycleDate(y, m - 1, g.billDayOfMonth);
      for (const membership of memberships.filter(
        (m) => m.groupId === g.id && !m.leftAt,
      )) {
        if (
          new Date(membership.joinedAt) > istInstant(issue) ||
          new Date(g.createdAt) > istInstant(issue) ||
          istInstant(issue) > now ||
          !members.some(
            (m) => m.id === membership.memberId && m.status === "ACTIVE",
          )
        )
          continue;
        const period = today.slice(0, 7);
        if (
          existing.some(
            (b) =>
              b.membershipId === membership.id && b.billingPeriod === period,
          )
        )
          continue;
        const b = {
          id: id(),
          branchId: "main",
          membershipId: membership.id,
          billingPeriod: period,
          purpose: g.name + " · " + period,
          amountPaise: g.amountPaise,
          paidPaise: 0,
          status: "ISSUED",
          createdAt: now.toISOString(),
        };
        await bill(b);
        existing.push(b);
      }
    }
  });
}
