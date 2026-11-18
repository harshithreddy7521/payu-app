import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, randomBytes } from "node:crypto";
import { configureEngine } from "./repository";
import { TABLES, Table, Row } from "./schema";
import {exportEncrypted,restoreEncrypted} from "./backupService";
import { setup, apiFetch, account, admin, createUser, lock } from "./api";
test("local SQLite: admin setup, access checks, retry safety, payments and lock survive offline without fetch", async () => {
  const db = new DatabaseSync(":memory:");
  for (const t of TABLES)
    db.exec(`CREATE TABLE "${t}"(id TEXT PRIMARY KEY,data TEXT)`);
  let chain = Promise.resolve();
  const all = async (t: Table) =>
    (db.prepare(`SELECT data FROM "${t}"`).all() as { data: string }[]).map(
      (r) => JSON.parse(r.data),
    );
  const put = async (t: Table, r: Row) => {
    db.prepare(`INSERT OR REPLACE INTO "${t}" VALUES(?,?)`).run(
      r.id,
      JSON.stringify(r),
    );
  };
  configureEngine({
    clear:async table=>{db.exec(`DELETE FROM "${table}"`);},
    all,
    put,
    id: randomUUID,
    randomBytes,
    tx: async <T>(f: () => Promise<T>) => {
      let release!: () => void;
      const previous = chain;
      chain = new Promise((r) => (release = r));
      await previous;
      db.exec("BEGIN");
      try {
        const r = await f();
        db.exec("COMMIT");
        return r;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      } finally {
        release();
      }
    },
  });
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Network forbidden");
  };
  try {
    await setup("Admin", "admin@example.com", "admin password", "Business");
    await assert.rejects(
      setup("Other", "x@y.com", "admin password", "Business"),
    );
    const login = await apiFetch<any>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "admin@example.com",
        password: "admin password",
      }),
    });
    const token = login.token;
    await admin(token);
    await createUser(
      "staff@example.com",
      "Collector",
      "staff password",
      "COLLECTOR",
    );
    const staff = await apiFetch<any>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "staff@example.com",
        password: "staff password",
      }),
    });
    await assert.rejects(admin(staff.token));
    async function request(
      path: string,
      body: unknown,
      key?: string,
      actor = token,
    ) {
      return apiFetch<any>(path, {
        method: "POST",
        token: actor,
        body: JSON.stringify(body),
        headers: key ? { "Idempotency-Key": key } : {},
      });
    }
    const body = { purpose: "Tuition", amountPaise: 12345 };
    const a = await request("/v1/quick-pay", body, "once");
    assert.equal(
      (await request("/v1/quick-pay", body, "once")).billId,
      a.billId,
    );
    await assert.rejects(
      request("/v1/quick-pay", { ...body, amountPaise: 100 }, "once"),
    );
    assert.notEqual(
      (await request("/v1/quick-pay", body, "new")).billId,
      a.billId,
    );
    const payment = {
      amountPaise: 12345,
      reference: "123456789012",
      receivedAt: new Date().toISOString(),
      verificationMethod: "UPI_APP",
      verified: true,
    };
    await assert.rejects(
      request(
        `/v1/transactions/${a.billId}/verified-payment`,
        payment,
        undefined,
        staff.token,
      ),
    );
    const receipt = await request(
      `/v1/transactions/${a.billId}/verified-payment`,
      payment,
    );
    assert.equal(
      (await request(`/v1/transactions/${a.billId}/verified-payment`, payment))
        .receiptNo,
      receipt.receiptNo,
    );
    assert.equal((await all("payments")).length, 1);
    assert.equal(
      (await all("bills")).find((b) => b.id === a.billId)?.status,
      "PAID",
    );
    await assert.rejects(
      request(`/v1/transactions/${a.billId}/verified-payment`, {
        ...payment,
        reference: "ANOTHER123456",
      }),
    );
    assert.equal((await all("payments")).length, 1);
    const backup=await exportEncrypted(token,"admin password","backup passphrase");
    await assert.rejects(exportEncrypted(staff.token,"staff password","backup passphrase"));
    await assert.rejects(restoreEncrypted(staff.token,"staff password","backup passphrase",backup));
    await request('/v1/quick-pay',{purpose:'After backup',amountPaise:100},'after-backup');
    const before=(await all('bills')).length;
    await assert.rejects(restoreEncrypted(token,"admin password","wrong passphrase",backup));
    assert.equal((await all('bills')).length,before);
    await restoreEncrypted(token,"admin password","backup passphrase",backup);
    assert.equal((await all('bills')).length,before-1);
    await assert.rejects(account(token));
    lock();
    await assert.rejects(account(token));
  } finally {
    globalThis.fetch = oldFetch;
    db.close();
  }
});
