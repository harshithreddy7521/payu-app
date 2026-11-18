import { test } from "node:test";
import assert from "node:assert/strict";
import { seal, unseal } from "./crypto";
import { TABLES, validateSnapshot, Snapshot } from "./schema";
function fixture() {
  const tables = Object.fromEntries(
    TABLES.map((t) => [t, []]),
  ) as unknown as Snapshot["tables"];
  tables.users = [
    {
      id: "admin",
      email: "a@example.com",
      role: "OWNER",
      active:true,
      hash: "a".repeat(64),
      salt: "b".repeat(32),
    },
  ];
  tables.branches = [{ id: "main", name: "Main" }];
  tables.bills = [
    { id: "b", branchId: "main", amountPaise: 12345, paidPaise: 12345 },
  ];
  tables.payments = [
    { id: "p", billId: "b", amountPaise: 12345, reference: "123456789012" },
  ];
  tables.receipts = [{ id: "r", paymentId: "p", billId: "b" }];
  return { version: 1 as const, tables };
}
test("encrypted full-table backup round-trips, hides records, rejects wrong key/tampering", async () => {
  const data = fixture();
  const envelope = await seal(
    data,
    "correct passphrase",
    new Uint8Array(16).fill(1),
    new Uint8Array(12).fill(2),
  );
  assert(!envelope.includes("a@example.com"));
  assert.deepEqual(
    validateSnapshot(await unseal(envelope, "correct passphrase")),
    data,
  );
  await assert.rejects(unseal(envelope, "wrong password"));
  const altered = JSON.parse(envelope);
  altered.ciphertext = "ff" + altered.ciphertext.slice(2);
  await assert.rejects(unseal(JSON.stringify(altered), "correct passphrase"));
  await assert.rejects(
    seal(data, "short", new Uint8Array(16), new Uint8Array(12)),
  );
});
test("restore validation rejects duplicate IDs, invalid versions, missing admins and corrupt financial references", () => {
  assert.equal(validateSnapshot(fixture()).tables.bills.length, 1);
  for (const mutate of [
    (d: any) => (d.version = 2),
    (d: any) => (d.tables.users = []),
    (d: any) => (d.tables.bills[0].paidPaise = 100),
    (d: any) => (d.tables.payments[0].billId = "missing"),
    (d: any) => (d.tables.receipts[0].paymentId = "missing"),
    (d: any) => d.tables.branches.push(d.tables.branches[0]),
  ]) {
    const d = fixture();
    mutate(d);
    assert.throws(() => validateSnapshot(d));
  }
});
