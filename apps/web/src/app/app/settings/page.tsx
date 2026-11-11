"use client";
import { getUser } from "@/lib/auth";

export default function SettingsPage() {
  const user = getUser();
  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>
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
          Full settings (settlement destination, staff invites, MFA, branding) are Phase 1 build items — wired to API in next iteration.
        </p>
      </div>
    </div>
  );
}
