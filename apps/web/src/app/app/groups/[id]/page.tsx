"use client";
import { useEffect, useState, useRef, use } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";
type Group = {
  id: string;
  name: string;
  amountPaise: number;
  isActive: boolean;
  nextBillDates: string[];
  memberships: {
    id: string;
    memberId: string;
    leftAt: string | null;
    amountPaise: number | null;
    member: { name: string };
  }[];
  reminderPolicies: {
    offsetDays: number;
    sendTimeIST: string;
    language: string;
    channels: string[];
    isActive: boolean;
  }[];
};
export default function GroupDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [group, setGroup] = useState<Group | null>(null),
    [members, setMembers] = useState<{ id: string; name: string }[]>([]),
    [member, setMember] = useState(""),
    [amount, setAmount] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [offsets, setOffsets] = useState("-3, 0, 3"),
    [time, setTime] = useState("10:00"),
    [language, setLanguage] = useState("en"),
    [channel, setChannel] = useState("WHATSAPP");
  async function load() {
    try {
      const g = await apiFetch<Group>(`/v1/groups/${id}`, {
        token: getToken()!,
      });
      setGroup(g);
      const r = await apiFetch<{ data: { id: string; name: string }[] }>(
        "/v1/members",
        { token: getToken()! },
      );
      setMembers(r.data);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  const requestRef = useRef<{ body: string; key: string } | null>(null);
  async function action(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      const fingerprint = JSON.stringify({ path, method, body });
      if (requestRef.current?.body !== fingerprint)
        requestRef.current = { body: fingerprint, key: crypto.randomUUID() };
      await apiFetch(path, {
        headers: { "Idempotency-Key": requestRef.current!.key },
        method,
        token: getToken()!,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      requestRef.current = null;
      setMessage("Changes saved.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!group)
    return (
      <div className="page">
        {error ? <p className="error-msg">{error}</p> : "Loading group…"}
      </div>
    );
  return (
    <div className="page">
      <Link href="/app/groups">← All groups</Link>
      <div className="page-heading" style={{ marginTop: 24 }}>
        <div>
          <p className="eyebrow">GROWING TOGETHER</p>
          <h1 className="page-title">{group.name}</h1>
          <p className="page-subtitle">
            ₹{(group.amountPaise / 100).toLocaleString("en-IN")} per month ·{" "}
            {group.isActive ? "Billing active" : "Billing paused"}
          </p>
        </div>
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() =>
            void action(`/v1/groups/${id}`, "PATCH", {
              isActive: !group.isActive,
            })
          }
        >
          {group.isActive ? "Pause future billing" : "Resume billing"}
        </button>
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
      <section className="card insight-panel" style={{ marginBottom: 24 }}>
        <h3>Your next three cycles</h3>
        <p>Existing bills keep their original terms when a group changes.</p>
        <div className="cycle-grid">
          {group.nextBillDates.map((d) => (
            <div className="cycle-card" key={d}>
              <small>ISSUE DATE · IST</small>
              <strong>{d}</strong>
              <p>₹{(group.amountPaise / 100).toLocaleString("en-IN")}</p>
            </div>
          ))}
        </div>
        {!group.nextBillDates.length && (
          <p className="notice">
            No future cycles before this group’s end date.
          </p>
        )}
      </section>
      <div className="dashboard-bottom">
        <section className="card insight-panel">
          <h3>Members in this group</h3>
          <p>Joining now starts billing at the next eligible cycle.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(`/v1/groups/${id}/members`, "POST", {
                memberId: member,
                amountPaise: amount
                  ? Math.round(Number(amount) * 100)
                  : undefined,
              });
            }}
          >
            <div className="field" style={{ marginTop: 20 }}>
              <label className="label" htmlFor="member">
                Add a member
              </label>
              <select
                className="select"
                id="member"
                required
                value={member}
                onChange={(e) => setMember(e.target.value)}
              >
                <option value="">Choose member</option>
                {members
                  .filter(
                    (m) =>
                      !group.memberships.some(
                        (x) => x.memberId === m.id && !x.leftAt,
                      ),
                  )
                  .map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="override">
                Monthly override (₹, optional)
              </label>
              <input
                id="override"
                className="input"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" disabled={busy}>
              Add to next cycle
            </button>
          </form>
          <div style={{ marginTop: 24 }}>
            {group.memberships
              .filter((m) => !m.leftAt)
              .map((m) => (
                <div
                  key={m.id}
                  style={{
                    padding: "14px 0",
                    borderTop: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <span>
                    {m.member.name}
                    <small
                      style={{ display: "block", color: "var(--text-muted)" }}
                    >
                      ₹
                      {(
                        (m.amountPaise ?? group.amountPaise) / 100
                      ).toLocaleString("en-IN")}
                      /month
                    </small>
                  </span>
                  <button
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() =>
                      void action(
                        `/v1/groups/${id}/members/${m.memberId}`,
                        "DELETE",
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
          </div>
        </section>
        <section className="card insight-panel">
          <h3>A gentle nudge, at the right time.</h3>
          <p>
            Schedule reminders in IST. Payment, contact preferences, and
            outstanding balance are checked before every send.
          </p>
          <p className="notice">
            Active policy:{" "}
            {group.reminderPolicies
              .filter((p) => p.isActive)
              .map(
                (p) =>
                  `${p.offsetDays > 0 ? "+" : ""}${p.offsetDays}d · ${p.sendTimeIST}`,
              )
              .join(" / ") || "No reminders"}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(
                `/v1/groups/${id}/reminders`,
                "PUT",
                offsets.split(",").map((o) => ({
                  offsetDays: Number(o.trim()),
                  sendTimeIST: time,
                  language,
                  channels:
                    channel === "FALLBACK" ? ["WHATSAPP", "SMS"] : [channel],
                })),
              );
            }}
          >
            <div className="field">
              <label className="label" htmlFor="offsets">
                Days relative to due date
              </label>
              <input
                id="offsets"
                className="input"
                value={offsets}
                onChange={(e) => setOffsets(e.target.value)}
                placeholder="-3, 0, 3"
                required
              />
            </div>
            <div className="form-row">
              <div className="field">
                <label className="label" htmlFor="time">
                  Send time IST (08:00–19:59)
                </label>
                <input
                  id="time"
                  className="input"
                  type="time"
                  min="08:00"
                  max="19:59"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="language">
                  Language
                </label>
                <select
                  id="language"
                  className="select"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="channel">
                Channel
              </label>
              <select
                id="channel"
                className="select"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                <option value="WHATSAPP">WhatsApp</option>
              </select>
            </div>
            <button className="btn btn-primary" disabled={busy}>
              Save reminder policy
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
