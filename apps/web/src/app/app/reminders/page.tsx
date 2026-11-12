"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";
type Reminder = {
  id: string;
  status: string;
  channel: string;
  scheduledAt: string;
  sentAt: string | null;
  failureReason: string | null;
  bill: { purpose: string; amountPaise: number; paidPaise: number };
};
export default function Reminders() {
  const [settings,setSettings]=useState({reminderStartHour:8,reminderEndHour:20,reminderDailyCap:3});
  const [rows, setRows] = useState<Reminder[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      const r = await apiFetch<{ data: Reminder[] }>("/v1/reminders", {
        token: getToken()!,
      });
      setRows(r.data);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
    apiFetch<typeof settings>("/v1/reminder-settings",{token:getToken()!}).then(setSettings).catch(e=>setError(e.message));
  }, []);
  async function run() {
    setBusy(true);
    try {
      const r = await apiFetch<{ issued: number }>("/v1/billing/run", {
        method: "POST",
        token: getToken()!,
        body: "{}",
      });
      setMessage(
        `${r.issued} eligible bills issued. Future cycles are created automatically by the worker.`,
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function resend(id: string) {
    try {
      await apiFetch("/v1/reminders/resend", {
        method: "POST",
        token: getToken()!,
        body: JSON.stringify({ occurrenceId: id }),
      });
      setMessage(
        "Reminder queued. Eligibility will be checked before dispatch.",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">A LITTLE NUDGE. A LOT LESS ADMIN.</p>
          <h1 className="page-title">Thoughtful reminders.</h1>
          <p className="page-subtitle">
            A clear view of what’s queued, sent, and safely suppressed.
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => void run()}
          disabled={busy}
        >
          Check eligible billing
        </button>
      </div>
      <div className="notice">
        {settings.reminderStartHour}:00–{settings.reminderEndHour}:00 IST sending window · Up to {settings.reminderDailyCap} reminders per recipient per 24 hours
        · Payment-in-progress grace period: 10 minutes. Demo messages use the
        fake provider.
      </div>
      {error && (
        <p className="error-msg" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success-msg" role="status">
          {message}
        </p>
      )}
      <div className="stat-grid">
        {["QUEUED", "SUBMITTED", "SUPPRESSED"].map((s) => (
          <div className="card stat-card" key={s}>
            <p className="stat-label">{s}</p>
            <p className="stat-value">
              {rows.filter((r) => r.status === s).length}
            </p>
            <p className="stat-foot">Among the latest 100 occurrences</p>
          </div>
        ))}
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Bill</th>
              <th>Remaining</th>
              <th>Channel</th>
              <th>Scheduled · IST</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && (
              <tr>
                <td colSpan={6} className="empty-state">
                  No reminders yet. They appear when a group’s billing cycle
                  begins.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.bill?.purpose}
                  <small
                    style={{ display: "block", color: "var(--text-muted)" }}
                  >
                    {r.failureReason}
                  </small>
                </td>
                <td>
                  ₹
                  {(
                    (r.bill.amountPaise - r.bill.paidPaise) /
                    100
                  ).toLocaleString("en-IN")}
                </td>
                <td>{r.channel}</td>
                <td>
                  {new Date(r.scheduledAt).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}
                </td>
                <td>
                  <span
                    className={`badge ${r.status === "SUBMITTED" ? "badge-success" : r.status === "QUEUED" ? "badge-warn" : "badge-neutral"}`}
                  >
                    {r.status}
                  </span>
                </td>
                <td>
                  {!["QUEUED", "UNKNOWN"].includes(r.status) &&
                    r.bill.amountPaise > r.bill.paidPaise && (
                      <button
                        className="btn btn-ghost"
                        onClick={() => void resend(r.id)}
                      >
                        Resend
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
