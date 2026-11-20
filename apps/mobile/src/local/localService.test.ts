import { requestPasswordReset, resetPassword } from "./passwordReset";
import { localDate, nextBillDates } from "../../../api/src/lib/billing";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, randomBytes } from "node:crypto";
import { configureEngine } from "./repository";
import { registerSchool, syncCloud, unlockCloud } from "./cloud";
import { TABLES, Table, Row } from "./schema";
import { exportEncrypted, restoreEncrypted } from "./backupService";
import {
  setup,
  apiFetch,
  account,
  admin,
  createUser,
  lock,
  runBilling,
} from "./api";
test("local SQLite: admin setup, access checks, retry safety, payments and lock survive offline without fetch", async () => {
  assert.deepEqual(
    nextBillDates(
      { frequency: "QUARTERLY", billDayOfMonth: 5, createdAt: "2026-01-01" },
      2,
      new Date("2026-02-01"),
    ),
    ["2026-04-05", "2026-07-05"],
  );
  assert.deepEqual(
    nextBillDates(
      { frequency: "YEARLY", billDayOfMonth: 5, createdAt: "2026-01-01" },
      2,
      new Date("2026-02-01"),
    ),
    ["2027-01-05", "2028-01-05"],
  );
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
    clear: async (table) => {
      db.exec(`DELETE FROM "${table}"`);
    },
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
    const localSchool = {
      name: "Example School",
      address: "1 School Road",
      phone: "9876543210",
      vpa: "exampleschool@upi",
      storage: "local",
    } as const;
    await setup("Admin", "admin@example.com", "admin password", localSchool);
    await assert.rejects(
      setup("Other", "x@y.com", "admin password", localSchool),
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
    const qr = new URL(a.upiIntentUrl);
    assert.equal(qr.searchParams.get("pa"), "exampleschool@upi");
    assert.equal(qr.searchParams.get("am"), "123.45");
    assert.equal(qr.searchParams.get("tr"), a.billId.replaceAll("-", ""));
    await assert.rejects(
      request(
        "/v1/local/profile",
        { vpa: "other@upi" },
        undefined,
        staff.token,
      ),
    );
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
    const csv =
      "name,externalRef,guardianName,phone\nStudent,student-01,Guardian,9876543210";
    const csvPreview = await request("/v1/members/import", { csv });
    assert.equal(csvPreview.rows[0].errors.length, 0);
    assert.equal(
      (await request("/v1/members/import", { csv, confirm: true })).imported,
      1,
    );
    const imported = (await all("members"))[0];
    const added = await request(
      "/v1/members",
      {
        name: "New student",
        feePaise: 10000,
        hostelFeePaise: 500,
        concessionPercent: 99,
      },
      undefined,
      staff.token,
    );
    assert.equal(added.feePaise, 10000);
    assert.equal(added.hostelFeePaise, 500);
    assert.equal(added.concessionPercent, 0);
    await assert.rejects(
      request(
        "/v1/groups",
        { name: "Unauthorized", amountPaise: 100 },
        undefined,
        staff.token,
      ),
      /administrator/,
    );
    await assert.rejects(
      apiFetch(`/v1/members/${imported.id}/fees`, {
        token: staff.token,
        method: "PUT",
        body: JSON.stringify({ concessionPercent: 20 }),
      }),
      /administrator/,
    );
    await apiFetch(
      `/v1/members/${imported.id}/guardians/${imported.guardians[0].id}/whatsapp-consent`,
      {
        token,
        method: "PUT",
        body: JSON.stringify({
          optIn: true,
          evidence: "Guardian requested WhatsApp",
        }),
      },
    );
    await apiFetch("/v1/reminder-settings", {
      token,
      method: "PUT",
      body: JSON.stringify({
        reminderStartHour: 0,
        reminderEndHour: 24,
        reminderDailyCap: 1,
      }),
    });
    const group = {
      id: randomUUID(),
      name: "Class 1",
      branchId: "main",
      isActive: true,
      amountPaise: 1000,
      dueDayOffset: 1,
      frequency: "MONTHLY",
      billDayOfMonth: 5,
      createdAt: "2020-01-01T00:00:00.000Z",
      endsAt: "2020-02-28T00:00:00.000Z",
    };
    await put("groups", group);
    await put("memberships", {
      id: randomUUID(),
      groupId: group.id,
      memberId: imported.id,
      amountPaise: 1500,
      joinedAt: "2020-01-02T00:00:00.000Z",
      leftAt: null,
    });
    assert.equal(await runBilling(new Date("2020-03-01T00:00:00Z")), 2);
    assert.equal(await runBilling(new Date("2020-03-01T00:00:00Z")), 0);
    const groups = await apiFetch<any>("/v1/groups", { token });
    assert.equal(groups.data[0]._count.memberships, 1);
    await apiFetch(`/v1/members/${imported.id}/fees`, {
      token,
      method: "PUT",
      body: JSON.stringify({ concessionPercent: 20 }),
    });
    const reminders = await apiFetch<any>("/v1/reminders", {
      token: staff.token,
    });
    const ready = reminders.data.find((entry: any) => entry.status === "READY");
    assert.equal(ready.bill.amountPaise, 1200);
    const handoff = await request(
      "/v1/reminders/resend",
      { occurrenceId: ready.id },
      undefined,
      staff.token,
    );
    assert.match(
      new URL(handoff.whatsappUrl).searchParams.get("text")!,
      /₹12\.00/,
    );
    assert.match(handoff.whatsappUrl, /^https:\/\/wa\.me\/919876543210/);
    await assert.rejects(
      request("/v1/reminders/resend", { occurrenceId: ready.id }),
      /daily reminder limit/,
    );
    const instant = await request("/v1/quick-pay", {
      ...body,
      deliveryChannel: "WHATSAPP",
      deliveryConsent: true,
      recipientPhone: "9876543210",
      webOrigin: "https://fees.example.com",
    });
    assert.match(
      new URL(instant.whatsappUrl).searchParams.get("text")!,
      /https:\/\/fees\.example\.com\/pay\/direct#/,
    );
    await assert.rejects(
      request("/v1/quick-pay", {
        ...body,
        deliveryChannel: "WHATSAPP",
        recipientPhone: "9876543210",
      }),
      /recipient permission/,
    );

    const yearStart = localDate().slice(0, 7) + "-01";
    const classGroup = await request("/v1/groups", {
      name: "Annual class",
      branchId: "main",
      amountPaise: 1_200_000,
      feePlan: {
        mode: "SCHOOL",
        startsOn: yearStart,
        hostelPaise: 120_000,
        charges: [
          {
            name: "Books",
            amountPaise: 100_000,
            optional: false,
            upfront: false,
          },
        ],
      },
    });
    const enrolled = await request(
      "/v1/members",
      {
        name: "Annual student",
        groupId: classGroup.id,
        paymentPlan: "MONTHLY",
        hostel: true,
        feePaise: 100,
        concessionPercent: 100,
      },
      undefined,
      staff.token,
    );
    await apiFetch(`/v1/members/${enrolled.id}/fees`, {
      token,
      method: "PUT",
      body: JSON.stringify({ concessionPercent: 10 }),
    });
    await runBilling();
    const annual = (await all("bills")).find(
      (bill) => bill.memberId === enrolled.id,
    );
    assert.equal(annual?.amountPaise, 200_000);
    assert.equal(annual?.plannedTotalPaise, 1_300_000);
    const secondClass = await request("/v1/groups", {
      name: "Second class",
      branchId: "main",
      amountPaise: 1_200_000,
      feePlan: {
        mode: "SCHOOL",
        startsOn: yearStart,
        hostelPaise: 0,
        charges: [],
      },
    });
    await assert.rejects(
      request(
        `/v1/groups/${secondClass.id}/members`,
        {
          memberId: enrolled.id,
          paymentPlan: "MONTHLY",
        },
        undefined,
        staff.token,
      ),
      /already belongs/,
    );
    await request(`/v1/transactions/${annual!.id}/verified-payment`, {
      ...payment,
      amountPaise: 300_000,
      reference: "PREPAY2026",
    });
    await runBilling();
    const prepaid = (await all("bills")).find((bill) => bill.id === annual!.id);
    assert.equal(prepaid?.amountPaise - prepaid?.paidPaise, 0);
    assert.equal(prepaid?.plannedTotalPaise - prepaid?.paidPaise, 1_000_000);
    const linked = await request(
      "/v1/quick-pay",
      {
        memberId: enrolled.id,
        purpose: "School event",
        amountPaise: 15000,
      },
      "quick-member",
      staff.token,
    );
    assert.equal(
      (await all("bills")).find((bill) => bill.id === linked.billId)?.memberId,
      enrolled.id,
    );
    const billCount = (await all("bills")).length;
    const existingRequest = await request(
      "/v1/quick-pay",
      {
        memberId: enrolled.id,
        existingBillId: annual!.id,
        purpose: "Tuition advance",
        amountPaise: 50000,
      },
      "quick-existing",
      staff.token,
    );
    assert.equal(existingRequest.billId, annual!.id);
    assert.equal((await all("bills")).length, billCount);
    assert.equal(
      new URL(existingRequest.upiIntentUrl).searchParams.get("am"),
      "500.00",
    );
    await assert.rejects(
      request(
        "/v1/quick-pay",
        {
          memberId: imported.id,
          existingBillId: annual!.id,
          purpose: "Bad charge",
          amountPaise: 100,
        },
        undefined,
        staff.token,
      ),
      /for this member/,
    );
    const payLinked = {
      ...payment,
      amountPaise: 10000,
      reference: "LINKED1500",
    };
    await request(
      `/v1/transactions/${linked.billId}/verified-payment`,
      payLinked,
    );
    await request(
      `/v1/transactions/${linked.billId}/verified-payment`,
      payLinked,
    );
    const balance = await apiFetch<any>(`/v1/members/${enrolled.id}/balance`, {
      token: staff.token,
    });
    assert.deepEqual(balance.totals, {
      paidPaise: 310_000,
      duePaise: 5000,
      remainingPaise: 1_005_000,
    });
    const roster = await apiFetch<any>("/v1/members?q=Annual%20student", {
      token: staff.token,
    });
    assert.deepEqual(roster.data[0].totals, balance.totals);
    const lookup = await apiFetch<any>(
      "/v1/members?lookup=1&q=Annual%20student",
      { token: staff.token },
    );
    assert.equal(lookup.data[0].id, enrolled.id);

    const backup = await exportEncrypted(
      token,
      "admin password",
      "backup passphrase",
    );
    await assert.rejects(
      exportEncrypted(staff.token, "staff password", "backup passphrase"),
    );
    await assert.rejects(
      restoreEncrypted(
        staff.token,
        "staff password",
        "backup passphrase",
        backup,
      ),
    );
    await request(
      "/v1/quick-pay",
      { purpose: "After backup", amountPaise: 100 },
      "after-backup",
    );
    const before = (await all("bills")).length;
    await assert.rejects(
      restoreEncrypted(token, "admin password", "wrong passphrase", backup),
    );
    assert.equal((await all("bills")).length, before);
    await restoreEncrypted(
      token,
      "admin password",
      "backup passphrase",
      backup,
    );
    assert.equal((await all("bills")).length, before - 1);
    await assert.rejects(account(token));
    lock();
    await assert.rejects(account(token));
    const origin = process.env.EXPO_PUBLIC_WEB_URL;
    process.env.EXPO_PUBLIC_WEB_URL = "https://fees.example.com";
    let remote: { revision: string | null; snapshot?: string } = {
      revision: null,
    };
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.passphrase, undefined);
      if (body.action === "append")
        remote = { revision: body.revision, snapshot: body.snapshot };
      return Response.json(remote);
    };
    const input = {
      spreadsheetId: "abcdefghijklmnopqrstuv",
      credentials: JSON.stringify({
        type: "service_account",
        client_email: "test@example.test",
        private_key: "test key",
      }),
      passphrase: "cloud passphrase",
    };
    const profile = {
      name: "Cloud School",
      address: "1 School Road",
      phone: "9876543210",
      vpa: "cloudschool@upi",
      storage: "cloud",
    } as const;
    const wipe = () => {
      lock();
      for (const table of TABLES) db.exec(`DELETE FROM "${table}"`);
    };
    try {
      wipe();
      await registerSchool(
        "Admin",
        "admin@example.com",
        "admin password",
        profile,
        input,
      );
      const signIn = () =>
        request("/v1/auth/login", {
          email: "admin@example.com",
          password: "admin password",
        });
      const cloudToken = (await signIn()).token;
      const connection = await unlockCloud(cloudToken, "admin password");
      assert.ok(connection);
      await request("/v1/quick-pay", body, "cloud-bill", cloudToken);
      assert.equal(await syncCloud(connection), "Synced to Google Drive.");
      assert.equal(await syncCloud(connection), "Google Drive is up to date.");
      assert.ok(remote.snapshot);
      assert.ok(!remote.snapshot.includes("cloudschool@upi"));

      wipe();
      const restore = { ...input, restoreId: connection.workspaceId };
      await assert.rejects(
        registerSchool(
          "",
          "admin@example.com",
          "wrong password",
          profile,
          restore,
        ),
      );
      assert.equal((await all("users")).length, 0);
      await registerSchool(
        "",
        "admin@example.com",
        "admin password",
        profile,
        restore,
      );
      const restoredToken = (await signIn()).token;
      const restored = await unlockCloud(restoredToken, "admin password");
      assert.ok(restored);
      assert.equal((await all("bills")).length, 1);
      assert.equal(await syncCloud(restored), "Google Drive is up to date.");
      await request(
        "/v1/quick-pay",
        { ...body, purpose: "Offline change" },
        "offline-bill",
        restoredToken,
      );
      remote.revision = "a".repeat(64);
      await assert.rejects(syncCloud(restored), /diverged/);
      assert.equal((await all("bills")).length, 2);
      let pending:
        | { email: string; challenge: string; expires: number }
        | undefined;
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.action === "request") {
          pending = {
            email: body.email,
            challenge: body.challenge,
            expires: Date.now() + 60000,
          };
          return Response.json({ ok: true });
        }
        return body.token === "valid-proof" && pending
          ? Response.json(pending)
          : Response.json({ message: "Invalid" }, { status: 400 });
      };
      await requestPasswordReset("admin@example.com");
      await assert.rejects(
        resetPassword("invalid-proof", "new owner password", input.passphrase),
        /Invalid/,
      );
      await resetPassword(
        "valid-proof",
        "new owner password",
        input.passphrase,
      );
      await assert.rejects(
        resetPassword("valid-proof", "another password", input.passphrase),
        /fresh link/,
      );
      await assert.rejects(signIn(), /Invalid email or password/);
      const changed = await request("/v1/auth/login", {
        email: "admin@example.com",
        password: "new owner password",
      });
      assert.equal(
        (await unlockCloud(changed.token, "new owner password"))?.workspaceId,
        connection.workspaceId,
      );
      wipe();
      await setup("Owner", "owner@example.com", "owner password", {
        ...profile,
        industry: "RESTAURANT",
        storage: "local",
      });
      await createUser(
        "server@example.com",
        "Server",
        "server password",
        "COLLECTOR",
      );
      const server = await request("/v1/auth/login", {
        email: "server@example.com",
        password: "server password",
      });
      assert.equal(server.user.profile, "RESTAURANT");
      await assert.rejects(
        apiFetch("/v1/groups", { token: server.token }),
        /Quick Pay/,
      );
      const check = await request(
        "/v1/quick-pay",
        { purpose: "Table 5", amountPaise: 1500 },
        undefined,
        server.token,
      );
      await request(
        `/v1/transactions/${check.billId}/verified-payment`,
        {
          ...payment,
          amountPaise: 1500,
          reference: "RESTAURANT1500",
        },
        undefined,
        server.token,
      );
      const summary = await apiFetch<any>("/v1/dashboard", {
        token: server.token,
      });
      assert.equal(summary.grossConfirmedPaise, 1500);
    } finally {
      if (origin === undefined) delete process.env.EXPO_PUBLIC_WEB_URL;
      else process.env.EXPO_PUBLIC_WEB_URL = origin;
    }
  } finally {
    globalThis.fetch = oldFetch;
    db.close();
  }
});
