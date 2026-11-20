"use client";
import { rupeesToPaise } from "../../../../../mobile/src/lib/validation";
import StaffAccounts from "@/components/StaffAccounts";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { getDeviceSession } from "@/lib/device-store";
import { syncCloud } from "../../../../../mobile/src/local/cloud";
import type { SchoolProfile } from "../../../../../mobile/src/local/onboarding";
import { getUser } from "@/lib/auth";

export default function SettingsPage() {
  const user = getUser();
  const restaurant = user?.profile === "RESTAURANT";
  const [standardFee, setStandardFee] = useState("");
  const [school, setSchool] = useState<SchoolProfile>();
  const [upiNotice, setUpiNotice] = useState("");
  const cloud = getDeviceSession()?.cloud;
  const [settings, setSettings] = useState({
    reminderStartHour: 8,
    reminderEndHour: 20,
    reminderDailyCap: 3,
  });
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (user?.orgId === "local")
      apiFetch<SchoolProfile>("/v1/local/profile", { token: getToken()! })
        .then((profile) => {
          setSchool(profile);
          setStandardFee(
            profile.standardFeePaise
              ? (profile.standardFeePaise / 100).toFixed(2)
              : "",
          );
        })
        .catch((e) => setUpiNotice(e.message));
  }, [user?.orgId]);
  useEffect(() => {
    if (restaurant) return;
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
      {user?.orgId === "local" &&
        user.roles.some((role) => role === "OWNER") && <StaffAccounts />}
      {school &&
        user?.profile === "SCHOOL" &&
        user.roles.some((role) =>
          ["OWNER", "BRANCH_MANAGER"].includes(role),
        ) && (
          <form
            className="card form-card"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await apiFetch("/v1/local/school-fee", {
                  method: "PUT",
                  token: getToken()!,
                  body: JSON.stringify({
                    feePaise: rupeesToPaise(standardFee),
                  }),
                });
                setUpiNotice("Standard tuition fee saved.");
              } catch (error) {
                setUpiNotice((error as Error).message);
              }
            }}
          >
            <h2 className="form-title">Legacy group tuition</h2>
            <p>New classes use the annual tuition set on the class.</p>
            <label className="field">
              <span className="label">Tuition per billing cycle (₹)</span>
              <input
                className="input"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={standardFee}
                onChange={(e) => setStandardFee(e.target.value)}
              />
            </label>
            <button className="btn btn-primary">Save standard tuition</button>
          </form>
        )}
      {school && (
        <form
          className="card form-card"
          onSubmit={(event) => {
            event.preventDefault();
            void apiFetch<SchoolProfile>("/v1/local/profile", {
              method: "POST",
              token: getToken()!,
              body: JSON.stringify({ vpa: school.vpa }),
            })
              .then((updated) => {
                setSchool(updated);
                setUpiNotice("UPI address saved.");
              })
              .catch((e) => setUpiNotice(e.message));
          }}
        >
          <h2 className="form-title">{school.name}</h2>
          <p>
            {school.address} · {school.phone}
          </p>
          <p>
            {school.storage === "cloud" ? "Google Drive" : "Browser storage"}
          </p>
          {cloud && (
            <>
              <p>
                Cloud workspace ID <code>{cloud.workspaceId}</code>
              </p>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  void syncCloud(cloud)
                    .then(setUpiNotice)
                    .catch((e) => setUpiNotice(e.message))
                }
              >
                Sync Google Drive now
              </button>
            </>
          )}
          <label className="field">
            <span className="label">Workspace UPI address</span>
            <input
              className="input"
              required
              value={school.vpa}
              onChange={(e) => setSchool({ ...school, vpa: e.target.value })}
            />
          </label>
          <p>Direct UPI · Razorpay (coming later)</p>
          <button
            className="btn btn-primary"
            disabled={!user?.roles.includes("OWNER" as never)}
          >
            Save UPI address
          </button>
          <p role="status">{upiNotice}</p>
        </form>
      )}
      {!restaurant && (
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
            [
              "reminderDailyCap",
              "Maximum sends per recipient / 24 hours (1–10)",
            ],
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
      )}
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
        {user?.orgId !== "local" && (
          <p
            style={{ marginTop: 20, fontSize: 13, color: "var(--text-muted)" }}
          >
            Full settings (settlement destination, staff invites, MFA, branding)
            are Phase 1 build items — wired to API in next iteration.
          </p>
        )}
      </div>
    </div>
  );
}
