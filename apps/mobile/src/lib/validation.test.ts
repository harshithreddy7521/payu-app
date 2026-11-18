import { test } from "node:test";
import assert from "node:assert/strict";
import { rupeesToPaise, releaseApiOrigin } from "./validation";
test("native financial amounts preserve paise and reject rounding/invalid input", () => {
  assert.equal(rupeesToPaise("0.01"), 1);
  assert.equal(rupeesToPaise("123.45"), 12345);
  assert.equal(rupeesToPaise("500000"), 50000000);
  for (const amount of ["1.234", "-1", "0", "NaN", "1e3", "500000.01"])
    assert.throws(() => rupeesToPaise(amount));
});
test("release API refuses insecure and credential-bearing URLs", () => {
  assert.equal(
    releaseApiOrigin("https://api.example.com/", false),
    "https://api.example.com",
  );
  assert.throws(() => releaseApiOrigin("http://api.example.com", false));
  assert.throws(() => releaseApiOrigin("https://token@api.example.com", false));
  assert.equal(
    releaseApiOrigin("http://10.0.2.2:3001", true),
    "http://10.0.2.2:3001",
  );
});
