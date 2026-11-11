"use client";
import { useEffect, useState } from "react";
import { getToken } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

type Tx = { id: string; branchName: string; memberName?: string; purpose: string; amountPaise: number; paidPaise: number; status: string; createdAt: string };

const STATUS_BADGE: Record<string, string> = {
  PAID: "badge-success", PARTIAL: "badge-warn", ISSUED: "badge-neutral", CANCELLED: "badge-danger", EXPIRED: "badge-neutral",
};

export default function TransactionsPage() {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ data: Tx[] }>("/v1/transactions", { token: getToken()! })
      .then((r) => setTxs(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page"><div className="spinner" /></div>;
  if (error) return <div className="page"><p className="error-msg">{error}</p></div>;

  return (
    <div className="page">
      <h1 className="page-title">Transactions</h1>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Purpose</th><th>Member</th><th>Branch</th>
              <th>Amount</th><th>Paid</th><th>Status</th><th>Date</th>
            </tr>
          </thead>
          <tbody>
            {txs.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>No transactions yet</td></tr>
            )}
            {txs.map((t) => (
              <tr key={t.id}>
                <td>{t.purpose}</td>
                <td>{t.memberName ?? "—"}</td>
                <td>{t.branchName}</td>
                <td>₹{(t.amountPaise / 100).toLocaleString("en-IN")}</td>
                <td>₹{(t.paidPaise / 100).toLocaleString("en-IN")}</td>
                <td><span className={`badge ${STATUS_BADGE[t.status] ?? "badge-neutral"}`}>{t.status}</span></td>
                <td>{new Date(t.createdAt).toLocaleDateString("en-IN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
