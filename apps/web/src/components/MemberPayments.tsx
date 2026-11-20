"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken, getUser } from "@/lib/auth";
import {
  payable,
  remaining,
  type BalanceBill,
  type MemberTotals,
} from "../../../mobile/src/local/memberBalance";
import { rupeesToPaise } from "../../../mobile/src/lib/validation";

export const formatMoney = (paise: number) =>
  (paise / 100).toLocaleString("en-IN", { style: "currency", currency: "INR" });

export default function MemberPayments({
  memberId,
  name,
  requestedBill,
  requestedAmount,
  close,
  onSaved,
}: {
  memberId: string;
  name: string;
  requestedBill?: string;
  requestedAmount?: number;
  close: () => void;
  onSaved: () => void;
}) {
  const [details, setDetails] = useState<{
    name?: string;
    totals: MemberTotals;
    bills: BalanceBill[];
  }>();
  const [billId, setBillId] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const canRecord = getUser()?.roles.some((role) =>
    ["OWNER", "FINANCE"].includes(role),
  );
  const fetchBalance = () =>
    apiFetch<NonNullable<typeof details>>(`/v1/members/${memberId}/balance`, {
      token: getToken()!,
    });
  const openBills =
    details?.bills.filter((bill) => payable(bill) && remaining(bill) > 0) ?? [];
  const current = openBills.find((bill) => bill.id === billId);
  function selectBill(bill?: BalanceBill, prefill?: number) {
    setBillId(bill?.id ?? "");
    const amount =
      bill &&
      prefill &&
      Number.isSafeInteger(prefill) &&
      prefill > 0 &&
      prefill <= remaining(bill)
        ? prefill
        : bill
          ? bill.amountPaise - bill.paidPaise || remaining(bill)
          : 0;
    setAmount(bill ? (amount / 100).toFixed(2) : "");
  }
  useEffect(() => {
    heading.current?.focus();
    let active = true;
    void fetchBalance()
      .then((data) => {
        if (!active) return;
        setDetails(data);
        const outstanding = data.bills.filter(
          (bill) => payable(bill) && remaining(bill) > 0,
        );
        const requested = outstanding.find((bill) => bill.id === requestedBill);
        selectBill(
          requested ??
            outstanding.find((bill) => bill.amountPaise > bill.paidPaise) ??
            outstanding[0],
          requested ? requestedAmount : undefined,
        );
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [memberId, requestedBill, requestedAmount]);

  return (
    <section className="card form-card" style={{ marginBottom: 24 }}>
      <h2 className="form-title" ref={heading} tabIndex={-1}>
        {details?.name ?? name} · Payments
      </h2>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={close}
        disabled={busy}
      >
        Close
      </button>
      {!details && !error && <p role="status">Loading balance…</p>}
      {details && (
        <>
          <p>
            <strong>Paid</strong> {formatMoney(details.totals.paidPaise)}
            {" · "}
            <strong>Due now</strong> {formatMoney(details.totals.duePaise)}
            {" · "}
            <strong>Total remaining</strong>{" "}
            {formatMoney(details.totals.remainingPaise)}
          </p>
          {details.bills.length > 0 && (
            <details>
              <summary>View charges ({details.bills.length})</summary>
              <ul>
                {details.bills.map((bill) => (
                  <li key={bill.id}>
                    {bill.purpose} · Paid {formatMoney(bill.paidPaise)} ·
                    Remaining {formatMoney(payable(bill) ? remaining(bill) : 0)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {canRecord && openBills.length > 0 && (
            <form
              key={billId}
              onSubmit={async (event) => {
                event.preventDefault();
                if (!current || busy) return;
                const form = event.currentTarget;
                const fields = new FormData(form);
                setBusy(true);
                setError("");
                setReceipt("");
                try {
                  const amountPaise = rupeesToPaise(amount);
                  if (amountPaise > remaining(current))
                    throw new Error(
                      "Enter an amount within the selected charge’s balance.",
                    );
                  const result = await apiFetch<{ receiptNo: string }>(
                    `/v1/transactions/${current.id}/verified-payment`,
                    {
                      token: getToken()!,
                      method: "POST",
                      body: JSON.stringify({
                        amountPaise,
                        reference: fields.get("reference"),
                        verified: fields.get("verified") === "on",
                        verificationMethod: fields.get("method"),
                        note: fields.get("note"),
                        receivedAt: new Date(
                          String(fields.get("receivedAt")) + ":00+05:30",
                        ).toISOString(),
                      }),
                    },
                  );
                  setReceipt(result.receiptNo);
                  form.reset();
                  onSaved();
                  const data = await fetchBalance();
                  setDetails(data);
                  const outstanding = data.bills.filter(
                    (bill) => payable(bill) && remaining(bill) > 0,
                  );
                  selectBill(
                    outstanding.find((bill) => bill.id === current.id) ??
                      outstanding[0],
                  );
                } catch (cause) {
                  setError((cause as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h3>Record payment received</h3>
              <label className="field">
                <span className="label">Apply to charge</span>
                <select
                  className="select"
                  value={billId}
                  required
                  onChange={(event) =>
                    selectBill(
                      openBills.find((bill) => bill.id === event.target.value),
                    )
                  }
                >
                  {openBills.map((bill) => (
                    <option key={bill.id} value={bill.id}>
                      {bill.purpose} · {formatMoney(remaining(bill))} remaining
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">Amount received (₹)</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={current ? remaining(current) / 100 : undefined}
                  required
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="label">Bank or UPI reference</span>
                <input className="input" required name="reference" />
              </label>
              <label className="field">
                <span className="label">Received at (IST)</span>
                <input
                  className="input"
                  required
                  name="receivedAt"
                  type="datetime-local"
                  defaultValue={new Date(Date.now() + 330 * 60_000)
                    .toISOString()
                    .slice(0, 16)}
                />
              </label>
              <label className="field">
                <span className="label">Verified using</span>
                <select className="select" name="method">
                  <option value="UPI_APP">Receiving UPI app</option>
                  <option value="BANK_STATEMENT">Bank statement</option>
                </select>
              </label>
              <label className="field">
                <span className="label">Note (optional)</span>
                <input className="input" name="note" maxLength={500} />
              </label>
              <label className="field">
                <span>
                  <input name="verified" type="checkbox" required /> I confirmed
                  the credit in the receiving account.
                </span>
              </label>
              <button className="btn btn-primary" disabled={busy || !current}>
                {busy ? "Recording…" : "Record payment"}
              </button>
            </form>
          )}
        </>
      )}
      {error && (
        <p className="error-msg" role="alert">
          {error}
        </p>
      )}
      {receipt && (
        <p className="success-msg" role="status">
          Payment recorded. Receipt {receipt}.
        </p>
      )}
    </section>
  );
}
