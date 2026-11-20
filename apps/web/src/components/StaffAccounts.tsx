"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";

export default function StaffAccounts() {
  const [staff, setStaff] = useState<
    { id: string; name: string; email: string; role: string }[]
  >([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const result = await apiFetch<{ data: typeof staff }>("/v1/local/staff", {
      token: getToken()!,
    });
    setStaff(result.data);
  };
  useEffect(() => {
    void load().catch((e) => setStatus(e.message));
  }, []);
  return (
    <form
      className="card form-card"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const form = event.currentTarget;
        const data = new FormData(form);
        setBusy(true);
        try {
          await apiFetch("/v1/local/staff", {
            token: getToken()!,
            method: "POST",
            body: JSON.stringify(Object.fromEntries(data)),
          });
          form.reset();
          setStatus("Staff account created.");
          await load();
        } catch (error) {
          setStatus((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="form-title">Staff accounts</h2>
      {staff.map((user) => (
        <p key={user.id}>
          {user.name} · {user.email} ·{" "}
          {user.role === "OWNER"
            ? "Owner"
            : user.role === "BRANCH_MANAGER"
              ? "Administrator"
              : "Staff"}
        </p>
      ))}
      <p>
        Staff can add members and send reminders. Administrators manage
        concessions and groups. The owner manages accounts.
      </p>
      <label className="field">
        <span className="label">Staff name</span>
        <input className="input" name="name" required />
      </label>
      <label className="field">
        <span className="label">Staff email</span>
        <input className="input" name="email" type="email" required />
      </label>
      <label className="field">
        <span className="label">Access level</span>
        <select className="select" name="role">
          <option value="COLLECTOR">Staff</option>
          <option value="BRANCH_MANAGER">Administrator</option>
        </select>
      </label>
      <label className="field">
        <span className="label">Staff password</span>
        <input
          className="input"
          name="password"
          type="password"
          minLength={10}
          autoComplete="new-password"
          required
        />
      </label>
      <label className="field">
        <span className="label">Your owner password</span>
        <input
          className="input"
          name="ownerPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <button className="btn btn-primary" disabled={busy}>
        Create staff account
      </button>
      <p role="status">{status}</p>
    </form>
  );
}
