"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { UserSummary } from "@fee/shared";
import { useRouter } from "next/navigation";
import { login, saveSession } from "@/lib/auth";
import { openDeviceStore, setDeviceSession } from "@/lib/device-store";
import { all } from "../../../mobile/src/local/repository";
import { apiFetch, runBilling } from "../../../mobile/src/local/api";
import {
  registerSchool,
  unlockCloud,
} from "../../../mobile/src/local/cloud";
import {
  workspaceTypes,
  type WorkspaceType,
  type SchoolProfile,
} from "../../../mobile/src/local/onboarding";

type Session = { token: string; user: UserSummary };
const emptySchool: SchoolProfile = {
  industry: "SCHOOL",
  name: "",
  address: "",
  phone: "",
  vpa: "",
  storage: "local",
};

export default function WorkspaceAuth({ initialSignup = false }: { initialSignup?: boolean }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [exists, setExists] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [signup, setSignup] = useState(initialSignup);
  const [school, setSchool] = useState(emptySchool);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [credentials, setCredentials] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [restoreId, setRestoreId] = useState("");
  const restoring = school.storage === "cloud" && Boolean(restoreId.trim());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const existing = openDeviceStore();
      setExists(existing);
      if (existing)
        void all("settings")
          .then((settings) =>
            setWorkspaceName(
              settings.find((row) => row.id === "business")?.name ?? "",
            ),
          )
          .catch(() => {});
      setReady(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  function changeScreen(next: boolean) {
    setSignup(next);
    setError("");
    setMessage("");
    setPassword("");
    setConfirm("");
    setCredentials("");
    setPassphrase("");
    setRestoreId("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (signup) {
        if (password !== confirm) throw new Error("Passwords must match.");
        await registerSchool(name, email.trim(), password, school, {
          spreadsheetId,
          credentials,
          passphrase,
          restoreId,
        });
        changeScreen(false);
        window.history.replaceState(null, "", "/login");
        setWorkspaceName(
          (await all("settings")).find((row) => row.id === "business")?.name ??
            "",
        );
        setExists(true);
        setMessage(
          restoring
            ? "Workspace restored. Sign in to open Quick Pay."
            : "Account created. Sign in to open Quick Pay.",
        );
      } else {
        if (exists) {
          const authenticated = await apiFetch<Session>("/v1/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
          });
          await runBilling();
          const cloud = await unlockCloud(authenticated.token, password);
          setDeviceSession({ token: authenticated.token, cloud });
          saveSession(authenticated);
        } else {
          await login(email.trim(), password);
        }
        setPassword("");
        router.push("/app/quick-pay");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">
            {(workspaceName || "Feeflow").slice(0, 1)}
          </span>
          <span style={{ overflowWrap: "anywhere" }}>
            {workspaceName || "Feeflow"}
          </span>
        </div>
        <h1>
          Fees and <em>payments.</em>
        </h1>
        <img src="/collection-art.svg" alt="" />
      </section>
      <section className="login-form-panel">
        <div>
          <h2>
            {signup
              ? restoring
                ? "Restore a cloud workspace"
                : "Create a workspace"
              : "Sign in"}
          </h2>
          {error && (
            <p className="error-msg" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          {ready && signup && exists && (
            <p className="notice">
              This browser profile already has a workspace. Sign in to it, or open signup in a separate browser profile to create another workspace.
            </p>
          )}
          {ready && (!signup || !exists) && (
            <form onSubmit={submit}>
              {signup && !restoring && (
                <>
                  <label className="field">
                    <span className="label">Workspace type</span>
                    <select
                      className="select"
                      value={school.industry}
                      onChange={(e) =>
                        setSchool({
                          ...school,
                          industry: e.target.value as WorkspaceType,
                        })
                      }
                    >
                      {Object.entries(workspaceTypes).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field
                    label={
                      workspaceTypes[school.industry ?? "SCHOOL"] + " name"
                    }
                    value={school.name}
                    set={(name) => setSchool({ ...school, name })}
                  />
                  <Field
                    label="Address"
                    value={school.address}
                    set={(address) => setSchool({ ...school, address })}
                  />
                  <Field
                    label="Contact number"
                    value={school.phone}
                    set={(phone) => setSchool({ ...school, phone })}
                    type="tel"
                  />
                  <Field
                    label="Administrator name"
                    value={name}
                    set={setName}
                  />
                </>
              )}
              <Field
                label="Work email"
                value={email}
                set={setEmail}
                type="email"
                autoComplete="username"
              />
              <Field
                label={signup ? "Password (10+ characters)" : "Password"}
                value={password}
                set={setPassword}
                type="password"
                autoComplete={signup ? "new-password" : "current-password"}
                minLength={signup ? 10 : undefined}
              />
              {signup && (
                <>
                  <Field
                    label="Confirm password"
                    value={confirm}
                    set={setConfirm}
                    type="password"
                    autoComplete="new-password"
                  />
                  <div className="field">
                    <label className="label" htmlFor="storage">
                      Storage
                    </label>
                    <select
                      id="storage"
                      className="select"
                      value={school.storage}
                      onChange={(e) =>
                        setSchool({
                          ...school,
                          storage:
                            e.target.value === "cloud" ? "cloud" : "local",
                        })
                      }
                    >
                      <option value="local">This browser</option>
                      <option value="cloud">Google Drive</option>
                    </select>
                  </div>
                  {school.storage === "cloud" && (
                    <>
                      <p className="intro">
                        Create a Google spreadsheet with a tab named Feeflow and
                        share it with your service account as an editor.
                      </p>
                      <Field
                        label="Google spreadsheet ID"
                        value={spreadsheetId}
                        set={setSpreadsheetId}
                      />
                      <label className="field">
                        <span className="label">
                          Google service-account JSON key
                        </span>
                        <textarea
                          className="input"
                          rows={4}
                          value={credentials}
                          onChange={(e) => setCredentials(e.target.value)}
                          required
                          spellCheck={false}
                          autoComplete="off"
                        />
                      </label>
                      <Field
                        label="Existing cloud workspace ID (optional)"
                        value={restoreId}
                        set={setRestoreId}
                        required={false}
                      />
                      <Field
                        label="Cloud backup passphrase (12+ characters)"
                        value={passphrase}
                        set={setPassphrase}
                        type="password"
                        minLength={12}
                      />
                    </>
                  )}
                  {!restoring && (
                    <>
                      <div className="field">
                        <label className="label" htmlFor="payment">
                          Payment method
                        </label>
                        <select
                          className="select"
                          id="payment"
                          defaultValue="upi"
                        >
                          <option value="upi">Direct UPI</option>
                          <option value="razorpay" disabled>
                            Razorpay (coming later)
                          </option>
                        </select>
                      </div>
                      <Field
                        label="UPI address"
                        value={school.vpa}
                        set={(vpa) => setSchool({ ...school, vpa })}
                      />
                    </>
                  )}
                </>
              )}
              <button className="btn btn-primary" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : signup
                    ? restoring
                      ? "Restore workspace"
                      : "Create account"
                    : "Sign in"}
              </button>
            </form>
          )}
          <p>
            <Link className="btn btn-ghost" href={signup ? "/login" : "/signup"}>
              {signup ? "Back to sign in" : "Sign up · Create a workspace"}
            </Link>
          </p>
          {!signup && exists && (
            <p>
              <Link href="/reset-password">Forgot password?</Link>
            </p>
          )}
          <p>
            <Link href="/hosted-login">
              Sign in to an existing hosted workspace
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

function Field({
  label,
  value,
  set,
  type = "text",
  autoComplete,
  minLength,
  required = true,
}: {
  label: string;
  value: string;
  set: (value: string) => void;
  type?: string;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input
        className="input"
        type={type}
        value={value}
        onChange={(event) => set(event.target.value)}
        required={required}
        autoComplete={autoComplete}
        minLength={minLength}
      />
    </label>
  );
}
