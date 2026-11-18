export const TABLES = [
  "users",
  "branches",
  "members",
  "groups",
  "memberships",
  "bills",
  "payments",
  "receipts",
  "ledger",
  "settings",
  "audit",
  "requests",
] as const;
export type Table = (typeof TABLES)[number];
export type Row = { id: string; [key: string]: any };
export type Snapshot = { version: 1; tables: Record<Table, Row[]> };
export function validateSnapshot(value: unknown): Snapshot {
  const d = value as Snapshot;
  if (
    d?.version !== 1 ||
    !d.tables ||
    Object.keys(d.tables).length !== TABLES.length
  )
    throw new Error("Invalid backup table manifest.");
  const ids = {} as Record<Table, Set<string>>;
  for (const t of TABLES) {
    if (!Array.isArray(d.tables[t]) || d.tables[t].length > 100000)
      throw new Error("Invalid table: " + t);
    ids[t] = new Set();
    for (const r of d.tables[t]) {
      if (
        !r ||
        typeof r.id !== "string" ||
        !r.id ||
        r.id.length > 200 ||
        ids[t].has(r.id)
      )
        throw new Error("Invalid or duplicate row in " + t);
      ids[t].add(r.id);
    }
  }
  if (!d.tables.users.some((u) => u.role === "OWNER" && u.active === true))
    throw new Error("Backup must contain an administrator.");
  const emails = new Set<string>();
  for (const u of d.tables.users) {
    if (
      typeof u.email !== "string" ||
      u.email !== u.email.trim().toLowerCase() ||
      emails.has(u.email) ||
      !["OWNER", "COLLECTOR"].includes(u.role) ||
      !/^([0-9a-f]{64})$/.test(u.hash) ||
      !/^([0-9a-f]{32})$/.test(u.salt)
    )
      throw new Error("Invalid user account.");
    emails.add(u.email);
  }
  for (const m of d.tables.memberships)
    if (!ids.members.has(m.memberId) || !ids.groups.has(m.groupId))
      throw new Error("Broken group membership.");
  for (const g of d.tables.groups)
    if (
      !Number.isSafeInteger(g.amountPaise) ||
      g.amountPaise <= 0 ||
      g.amountPaise > 50000000 ||
      !ids.branches.has(g.branchId)
    )
      throw new Error("Invalid group fee/branch.");
  for (const b of d.tables.bills) {
    if (
      !Number.isSafeInteger(b.amountPaise) ||
      b.amountPaise <= 0 ||
      !Number.isSafeInteger(b.paidPaise) ||
      b.paidPaise < 0 ||
      b.paidPaise > b.amountPaise ||
      !ids.branches.has(b.branchId)
    )
      throw new Error("Invalid bill balance.");
  }
  const refs = new Set<string>();
  for (const p of d.tables.payments) {
    if (
      !ids.bills.has(p.billId) ||
      !Number.isSafeInteger(p.amountPaise) ||
      p.amountPaise <= 0 ||
      typeof p.reference !== "string" ||
      refs.has(p.reference)
    )
      throw new Error("Invalid or duplicate payment.");
    refs.add(p.reference);
  }
  for (const b of d.tables.bills)
    if (
      d.tables.payments
        .filter((p) => p.billId === b.id)
        .reduce((s, p) => s + p.amountPaise, 0) !== b.paidPaise
    )
      throw new Error("Payment totals do not match bill balance.");
  for (const r of d.tables.receipts)
    if (!ids.payments.has(r.paymentId) || !ids.bills.has(r.billId))
      throw new Error("Invalid receipt.");
  for (const p of d.tables.payments)
    if (d.tables.receipts.filter((r) => r.paymentId === p.id).length !== 1)
      throw new Error("Every payment must have one receipt.");
  if (JSON.stringify(d).length > 20_000_000)
    throw new Error("Database exceeds backup size limit.");
  return d;
}
