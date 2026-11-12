import { test } from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import { ManualUpiProvider } from "../providers/manualUpi.js";

test("direct UPI QR and intent use the configured payee and exact INR amount, never fake-confirm", async () => {
  const old = process.env.UPI_PAYEE_VPA;
  process.env.UPI_PAYEE_VPA = "7090832433@ybl";
  try {
    const provider = new ManualUpiProvider();
    const order = await provider.createOrder({ amountPaise: 12345, merchantOrderRef: "test", description: "Tuition & activity" });
    const url = new URL(order.upiIntentUrl!);
    assert.equal(url.protocol, "upi:");
    assert.equal(url.searchParams.get("pa"), "7090832433@ybl");
    assert.equal(url.searchParams.get("am"), "123.45");
    assert.equal(url.searchParams.get("cu"), "INR");
    assert.equal(url.searchParams.get("tn"), "Tuition & activity");
    assert.equal(order.qrCodeDataUrl, await QRCode.toDataURL(order.upiIntentUrl!));
    assert.equal((await provider.verifyPayment(order.providerOrderId)).status, "PENDING");
    await assert.rejects(provider.refund(), /verified payment provider/);
    await assert.rejects(provider.settle(), /does not support/);
    process.env.UPI_PAYEE_VPA = "future-company@bank";
    const future = await provider.createOrder({ amountPaise: 100, merchantOrderRef: "next", description: "Fee" });
    assert.equal(new URL(future.upiIntentUrl!).searchParams.get("pa"), "future-company@bank");
  } finally { if (old === undefined) delete process.env.UPI_PAYEE_VPA; else process.env.UPI_PAYEE_VPA = old; }
});
