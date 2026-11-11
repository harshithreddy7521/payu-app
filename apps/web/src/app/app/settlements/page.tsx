"use client";
import { useEffect, useState } from "react";
import { getToken } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

type Batch = { id: string; reportingDate: string; status: string; grossCollectionPaise?: number; netPaise: number; runAt?: string };

const STATUS_BADGE: Record<string, string> = { COMPLETED: "badge-success", RUNNING: "badge-warn", FAILED: "badge-danger", SCHEDULED: "badge-neutral" };

export default function SettlementsPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ data: Batch[] }>("/v1/settlements", { token: getToken()! })
      .then((r) => setBatches(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page"><div className="spinner" /></div>;
  if (error) return <div className="page"><p className="error-msg">{error}</p></div>;

  return (
    <div className="page">
      <h1 className="page-title">Settlements</h1>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Reporting date</th><th>Net payable</th><th>Status</th><th>Run at</th></tr>
          </thead>
          <tbody>
            {batches.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>No settlement batches yet</td></tr>
            )}
            {batches.map((b) => (
              <tr key={b.id}>
                <td>{b.reportingDate}</td>
                <td>₹{(b.netPaise / 100).toLocaleString("en-IN")}</td>
                <td><span className={`badge ${STATUS_BADGE[b.status] ?? "badge-neutral"}`}>{b.status}</span></td>
                <td>{b.runAt ? new Date(b.runAt).toLocaleString("en-IN") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
