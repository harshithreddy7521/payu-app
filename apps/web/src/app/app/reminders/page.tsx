"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken, getUser, isDeviceWorkspace } from "@/lib/auth";
type Reminder = {
  id: string;
  status: string;
  channel: string;
  scheduledAt: string;
  sentAt: string | null;
  failureReason: string | null;
  bill: {
    id: string;
    memberId?: string;
    purpose: string;
    amountPaise: number;
    paidPaise: number;
  };
};
export default function Reminders() {
  const local = isDeviceWorkspace();
  const [settings, setSettings] = useState({
    reminderStartHour: 8,
    reminderEndHour: 20,
    reminderDailyCap: 3,
  });
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
    apiFetch<typeof settings>("/v1/reminder-settings", { token: getToken()! })
      .then(setSettings)
      .catch((e) => setError(e.message));
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
        `${r.issued} eligible bills issued. ${local ? "Open WhatsApp to send ready reminders." : "Future cycles are created automatically by the worker."}`,
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function resend(id: string) {
    const tab = local ? window.open("about:blank", "_blank") : null;
    if (tab) tab.opener = null;
    try {
      const result = await apiFetch<{ whatsappUrl?: string }>(
        "/v1/reminders/resend",
        {
          method: "POST",
          token: getToken()!,
          body: JSON.stringify({
            occurrenceId: id,
            ...(local ? { webOrigin: window.location.origin } : {}),
          }),
        },
      );
      if (result.whatsappUrl) {
        if (tab) tab.location.href = result.whatsappUrl;
        else window.location.assign(result.whatsappUrl);
      }
      setMessage(
        local
          ? "WhatsApp draft opened."
          : "Reminder queued. Eligibility will be checked before dispatch.",
      );
      await load();
    } catch (e) {
      tab?.close();
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
        {(!local ||
          getUser()?.roles.some((role) =>
            ["OWNER", "BRANCH_MANAGER"].includes(role),
          )) && (
          <button
            className="btn btn-primary"
            onClick={() => void run()}
            disabled={busy}
          >
            Check eligible billing
          </button>
        )}
      </div>
      <div className="notice">
        {settings.reminderStartHour}:00–{settings.reminderEndHour}:00 IST
        sending window · Up to {settings.reminderDailyCap} reminders per
        recipient per 24 hours
        {local
          ? " · Open a ready draft in WhatsApp to send it."
          : " · Payment-in-progress grace period: 10 minutes. Demo messages use the fake provider."}
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
        {(local
          ? ["READY", "OPENED", "SUPPRESSED"]
          : ["QUEUED", "SUBMITTED", "SUPPRESSED"]
        ).map((s) => (
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
                  {r.bill.memberId && (
                    <Link
                      className="btn btn-ghost"
                      href={`/app/members?member=${encodeURIComponent(r.bill.memberId)}&bill=${encodeURIComponent(r.bill.id)}`}
                    >
                      Member payments
                    </Link>
                  )}
                  {(local
                    ? ["READY", "OPENED"].includes(r.status)
                    : !["QUEUED", "UNKNOWN"].includes(r.status)) &&
                    r.bill.amountPaise > r.bill.paidPaise && (
                      <button
                        className="btn btn-ghost"
                        onClick={() => void resend(r.id)}
                      >
                        {local ? "Open WhatsApp" : "Resend"}
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
