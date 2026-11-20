"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export default function DirectPaymentPage() {
  const [payment, setPayment] = useState<{
    intent: string;
    recipient: string;
    qr: string;
    amount: string;
  }>();
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    async function load() {
      const intent = decodeURIComponent(location.hash.slice(1));
      const url = new URL(intent);
      const recipient = url.searchParams.get("pa") ?? "";
      const amount = url.searchParams.get("am") ?? "";
      if (
        url.protocol !== "upi:" ||
        url.hostname !== "pay" ||
        url.pathname ||
        !/^[a-z0-9._-]+@[a-z0-9.-]+$/i.test(recipient) ||
        !/^\d{1,6}\.\d{2}$/.test(amount)
      )
        throw new Error("Invalid payment request");
      setPayment({
        intent,
        recipient,
        qr: await QRCode.toDataURL(intent),
        amount,
      });
    }
    void load().catch(() => setInvalid(true));
  }, []);
  return (
    <main className="page">
      <section
        className="card form-card"
        style={{ maxWidth: 480, margin: "auto" }}
      >
        <h1 className="form-title">Pay with UPI</h1>
        {invalid ? (
          <p role="alert">This payment link is invalid.</p>
        ) : payment ? (
          <>
            <p>
              ₹{payment.amount} to {payment.recipient}
            </p>
            <div className="qr-wrap">
              <img src={payment.qr} alt="Payment QR" />
            </div>
            <a className="btn btn-primary" href={payment.intent}>
              Open UPI app
            </a>
            <p>Check the recipient in your UPI app before paying.</p>
          </>
        ) : (
          <p role="status">Opening payment request…</p>
        )}
      </section>
    </main>
  );
}
