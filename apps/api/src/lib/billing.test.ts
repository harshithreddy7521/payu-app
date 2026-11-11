import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  cycleDate,
  istInstant,
  localDate,
  nextBillDates,
} from "./billing.js";
import { memberCsv, parseCsv } from "./csv.js";
test("IST date rollover, leap years and month-end clamping", () => {
  assert.equal(localDate(new Date("2026-01-31T19:00:00Z")), "2026-02-01");
  assert.equal(cycleDate(2028, 1, 31), "2028-02-29");
  assert.equal(cycleDate(2027, 1, null), "2027-02-28");
  assert.equal(
    istInstant("2026-11-14", "10:00").toISOString(),
    "2026-11-14T04:30:00.000Z",
  );
  assert.equal(addDays("2028-02-28", 3), "2028-03-02");
});
test("mid-cycle joining and end dates match billing preview", () => {
  assert.deepEqual(
    nextBillDates(
      { frequency: "MONTHLY", billDayOfMonth: 31 },
      3,
      new Date("2028-01-15T06:00:00Z"),
    ),
    ["2028-01-31", "2028-02-29", "2028-03-31"],
  );
  assert.deepEqual(
    nextBillDates(
      {
        frequency: "MONTHLY",
        billDayOfMonth: 1,
        endsAt: new Date("2028-03-15"),
      },
      3,
      new Date("2028-01-15"),
    ),
    ["2028-02-01", "2028-03-01"],
  );
  assert.deepEqual(nextBillDates({ frequency: "ONE_TIME" }, 3), []);
});
test("CSV supports quotes, BOM and CRLF; siblings can share a phone", () => {
  assert.deepEqual(parseCsv('\ufeffname,ref\r\n"Sharma, Arjun",A\r\n'), [
    ["name", "ref"],
    ["Sharma, Arjun", "A"],
  ]);
  const rows = memberCsv(
    "name,externalRef,guardianName,phone\nArjun,A,Ravi,9876543210\nPriya,B,Ravi,9876543210",
  );
  assert(rows.every((r) => r.errors.length === 0));
  assert(
    memberCsv(
      "name,externalRef,guardianName,phone\nA,X,Ravi,123\nB,X,,9876543210",
    ).every((r) => r.errors.length > 0),
  );
  assert.throws(() => memberCsv("name\nA"), /headers/);
  assert.throws(() => parseCsv('"unclosed'), /Unclosed/);
});
