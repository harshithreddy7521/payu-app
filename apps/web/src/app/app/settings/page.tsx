"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { getUser } from "@/lib/auth";

export default function SettingsPage() {
  const user = getUser();
  const [settings, setSettings] = useState({
    reminderStartHour: 8,
    reminderEndHour: 20,
    reminderDailyCap: 3,
  });
  const [notice, setNotice] = useState("");
  useEffect(() => {
    apiFetch<typeof settings>("/v1/reminder-settings", { token: getToken()! })
      .then(setSettings)
      .catch((e) => setNotice(e.message));
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch("/v1/reminder-settings", {
        method: "PUT",
        token: getToken()!,
        body: JSON.stringify(settings),
      });
      setNotice("Reminder settings saved.");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>
      <form
        className="card form-card"
        onSubmit={save}
        style={{ marginBottom: 24 }}
      >
        <h2 className="form-title">WhatsApp reminder limits</h2>
        <p className="notice">
          India Standard Time. Requires recorded contact permission. SMS
          integration is deferred.
        </p>
        {[
          ["reminderStartHour", "Start hour (0–23)"],
          ["reminderEndHour", "End hour (1–24)"],
          ["reminderDailyCap", "Maximum sends per recipient / 24 hours (1–10)"],
        ].map(([key, label]) => (
          <div className="field" key={key}>
            <label className="label" htmlFor={key}>
              {label}
            </label>
            <input
              className="input"
              id={key}
              type="number"
              required
              value={settings[key as keyof typeof settings]}
              onChange={(e) =>
                setSettings({ ...settings, [key]: Number(e.target.value) })
              }
            />
          </div>
        ))}
        <p role="status">{notice}</p>
        <button
          className="btn btn-primary"
          disabled={!user?.roles.includes("OWNER" as never)}
        >
          Save limits
        </button>
      </form>
      <div className="card form-card">
        <div className="form-title">Organisation</div>
        <div className="field">
          <div className="label">Name</div>
          <div>{user?.orgName}</div>
        </div>
        <div className="field">
          <div className="label">Profile</div>
          <div>{user?.profile}</div>
        </div>
        <div className="field">
          <div className="label">Your roles</div>
          <div>{user?.roles.join(", ")}</div>
        </div>
        <p style={{ marginTop: 20, fontSize: 13, color: "var(--text-muted)" }}>
          Full settings (settlement destination, staff invites, MFA, branding)
          are Phase 1 build items — wired to API in next iteration.
        </p>
      </div>
    </div>
  );
}
