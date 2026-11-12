"use client";
import { useEffect, useState, useRef } from "react";
import { getToken, getUser } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

type Tx = {
  id: string;
  branchName: string;
  memberName?: string;
  purpose: string;
  amountPaise: number;
  paidPaise: number;
  status: string;
  createdAt: string;
  payments: {
    receiptNo: string;
    amountPaise: number;
    source: string;
    referenceMasked: string;
    receivedAt: string | null;
    confirmedAt: string;
  }[];
};

const STATUS_BADGE: Record<string, string> = {
  PAID: "badge-success",
  PARTIAL: "badge-warn",
  ISSUED: "badge-neutral",
  CANCELLED: "badge-danger",
  EXPIRED: "badge-neutral",
};

export default function TransactionsPage() {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const formHeading = useRef<HTMLHeadingElement>(null);
  const [selected, setSelected] = useState<Tx | null>(null);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [method, setMethod] = useState("UPI_APP");
  const [note, setNote] = useState("");
  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [canVerify, setCanVerify] = useState(false);
  function openForm(bill: Tx) {
    setSelected(bill);
    setAmount(((bill.amountPaise - bill.paidPaise) / 100).toFixed(2));
    setReference("");
    setReceivedAt(
      new Date(Date.now() + 330 * 60000).toISOString().slice(0, 16),
    );
    setMethod("UPI_APP");
    setNote("");
    setVerified(false);
    setFormError("");
    setNotice("");
  }
  async function load(openRequested = false) {
    setError("");
    const id = new URLSearchParams(window.location.search).get("verify");
    try {
      const r = await apiFetch<{ data: Tx[] }>(
        `/v1/transactions${id ? `?billId=${encodeURIComponent(id)}` : ""}`,
        { token: getToken()! },
      );
      setTxs(r.data);
      if (
        openRequested &&
        id &&
        getUser()?.roles.some((role) => ["OWNER", "FINANCE"].includes(role))
      ) {
        const bill = r.data.find((b) => b.id === id);
        if (
          bill &&
          ["ISSUED", "PARTIAL", "EXPIRED"].includes(bill.status) &&
          bill.paidPaise < bill.amountPaise
        )
          openForm(bill);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setCanVerify(
      getUser()?.roles.some((role) => ["OWNER", "FINANCE"].includes(role)) ??
        false,
    );
    void load(true);
  }, []);
  useEffect(() => {
    if (selected) formHeading.current?.focus();
  }, [selected]);
  async function record(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || saving) return;
    const paise = Math.round(Number(amount) * 100);
    if (
      !Number.isSafeInteger(paise) ||
      paise <= 0 ||
      paise > selected.amountPaise - selected.paidPaise
    ) {
      setFormError("Enter an amount up to the outstanding balance.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const result = await apiFetch<{
        receiptNo: string;
        remainingPaise: number;
        replayed: boolean;
      }>(`/v1/transactions/${selected.id}/verified-payment`, {
        method: "POST",
        token: getToken()!,
        body: JSON.stringify({
          amountPaise: paise,
          reference,
          receivedAt: new Date(`${receivedAt}:00+05:30`).toISOString(),
          verificationMethod: method,
          note,
          verified,
        }),
      });
      setNotice(
        `Payment ${result.replayed ? "already recorded" : "recorded"}. Receipt ${result.receiptNo}. Remaining ₹${(result.remainingPaise / 100).toLocaleString("en-IN")}.`,
      );
      setSelected(null);
      await load();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const safe = (value: unknown) => {
      const text = String(value ?? "");
      return (
        '"' +
        (/^[=+@-]/.test(text) ? "'" : "") +
        text.replaceAll('"', '""') +
        '"'
      );
    };
    const rows = [
      [
        "Purpose",
        "Branch",
        "Amount INR",
        "Paid INR",
        "Status",
        "Bill created UTC",
      ],
      ...txs.map((t) => [
        t.purpose,
        t.branchName,
        (t.amountPaise / 100).toFixed(2),
        (t.paidPaise / 100).toFixed(2),
        t.status,
        t.createdAt,
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob([rows.map((row) => row.map(safe).join(",")).join("\r\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "feeflow-visible-transactions.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  if (loading)
    return (
      <div className="page">
        <div className="spinner" />
      </div>
    );

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">EVERY PAYMENT HAS A PLACE</p>
          <h1 className="page-title">Follow the flow.</h1>
          <p className="page-subtitle">
            A clear record of bills and payments. Showing the latest 50 bills.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={exportCsv}>
          ↓ Export visible rows
        </button>
      </div>
      {error && (
        <p className="error-msg" role="alert">
          {error}
          <button className="btn btn-ghost" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      {notice && (
        <p className="success-msg" role="status">
          {notice}
        </p>
      )}
      {selected && (
        <section
          className="card form-card form-wide"
          style={{ marginBottom: 24 }}
          aria-labelledby="verify-title"
        >
          <h2
            ref={formHeading}
            tabIndex={-1}
            id="verify-title"
            className="form-title"
          >
            Record verified payment
          </h2>
          <p>
            <strong>{selected.purpose}</strong>
          </p>
          <p className="notice">
            Check your receiving UPI app or bank statement first. This action
            records your verification; it does not check the bank or transfer
            money. A payer screenshot alone is not proof of receipt.
          </p>
          <form onSubmit={record}>
            <div className="form-row">
              <div className="field">
                <label htmlFor="verified-amount" className="label">
                  Amount received (₹)
                </label>
                <input
                  id="verified-amount"
                  className="input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={(selected.amountPaise - selected.paidPaise) / 100}
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="field">
                <label htmlFor="bank-reference" className="label">
                  UPI / bank transaction reference
                </label>
                <input
                  id="bank-reference"
                  className="input"
                  required
                  minLength={6}
                  maxLength={64}
                  pattern="[A-Za-z0-9][A-Za-z0-9-]{5,63}"
                  placeholder="Reference from your receiving account"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="received-time" className="label">
                  Received at (IST)
                </label>
                <input
                  id="received-time"
                  className="input"
                  type="datetime-local"
                  required
                  value={receivedAt}
                  onChange={(e) => setReceivedAt(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="field">
                <label htmlFor="verify-method" className="label">
                  Where did you verify receipt?
                </label>
                <select
                  id="verify-method"
                  className="select"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  disabled={saving}
                >
                  <option value="UPI_APP">Receiving UPI app</option>
                  <option value="BANK_STATEMENT">Bank statement</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="verification-note" className="label">
                Verification note (optional)
              </label>
              <textarea
                id="verification-note"
                className="input"
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={saving}
              />
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                marginBottom: 20,
              }}
            >
              <input
                type="checkbox"
                required
                checked={verified}
                onChange={(e) => setVerified(e.target.checked)}
                disabled={saving}
              />
              <span>
                I checked the receiving account and confirmed this amount was
                credited.
              </span>
            </label>
            {formError && (
              <p className="error-msg" role="alert">
                {formError}
              </p>
            )}
            <div className="toolbar">
              <button
                className="btn btn-primary"
                disabled={saving || !verified}
              >
                {saving ? "Recording…" : "Confirm verified payment"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={saving}
                onClick={() => setSelected(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Purpose</th>
              <th>Member</th>
              <th>Branch</th>
              <th>Amount</th>
              <th>Paid</th>
              <th>Status</th>
              <th>Date</th>
              <th>Verification</th>
            </tr>
          </thead>
          <tbody>
            {txs.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    textAlign: "center",
                    padding: 32,
                    color: "var(--text-muted)",
                  }}
                >
                  No transactions yet
                </td>
              </tr>
            )}
            {txs.map((t) => (
              <tr key={t.id}>
                <td>{t.purpose}</td>
                <td>{t.memberName ?? "—"}</td>
                <td>{t.branchName}</td>
                <td>₹{(t.amountPaise / 100).toLocaleString("en-IN")}</td>
                <td>₹{(t.paidPaise / 100).toLocaleString("en-IN")}</td>
                <td>
                  <span
                    className={`badge ${STATUS_BADGE[t.status] ?? "badge-neutral"}`}
                  >
                    {t.status}
                  </span>
                </td>
                <td>{new Date(t.createdAt).toLocaleDateString("en-IN")}</td>
                <td>
                  {t.payments?.map((p) => (
                    <div
                      key={p.receiptNo}
                      style={{ fontSize: 11, marginBottom: 8 }}
                    >
                      <strong>
                        {p.source === "MANUAL_UPI"
                          ? "Staff verified"
                          : "Provider confirmed"}
                      </strong>
                      <br />₹{(p.amountPaise / 100).toLocaleString("en-IN")} ·{" "}
                      {p.referenceMasked}
                      <br />
                      <span style={{ color: "var(--text-muted)" }}>
                        Receipt {p.receiptNo}
                      </span>
                    </div>
                  ))}
                  {canVerify &&
                    ["ISSUED", "PARTIAL", "EXPIRED"].includes(t.status) &&
                    t.paidPaise < t.amountPaise && (
                      <button
                        className="btn btn-ghost"
                        onClick={() => {
                          openForm(t);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        Record verified payment
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
