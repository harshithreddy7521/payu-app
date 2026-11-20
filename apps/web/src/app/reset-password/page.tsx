"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { openDeviceStore } from "@/lib/device-store";
import {
  requestPasswordReset,
  resetPassword,
} from "../../../../mobile/src/local/passwordReset";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setToken(window.location.hash.slice(1));
    try {
      openDeviceStore();
      setReady(true);
    } catch (error) {
      setStatus((error as Error).message);
    }
  }, []);
  return (
    <main className="page">
      <section className="card form-card form-wide">
        <h1 className="form-title">Reset your password</h1>
        {token && (
          <p>
            For Android, copy this page’s full address into the reset screen in
            the app.
          </p>
        )}
        {!complete && (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              const form = event.currentTarget;
              const data = new FormData(form);
              setBusy(true);
              setStatus("");
              try {
                if (token) {
                  const password = String(data.get("password"));
                  if (password !== data.get("confirm"))
                    throw new Error("Passwords must match.");
                  await resetPassword(
                    token,
                    password,
                    String(data.get("recovery")),
                  );
                  window.history.replaceState(null, "", "/reset-password");
                  setComplete(true);
                  setStatus(
                    "Password updated. Sign in with your new password.",
                  );
                } else {
                  await requestPasswordReset(email);
                  setStatus(
                    "If the account is available here, a reset link has been sent.",
                  );
                }
              } catch (error) {
                setStatus((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {token ? (
              <>
                <label className="field">
                  <span className="label">New password</span>
                  <input
                    className="input"
                    name="password"
                    type="password"
                    required
                    minLength={10}
                    autoComplete="new-password"
                  />
                </label>
                <label className="field">
                  <span className="label">Confirm password</span>
                  <input
                    className="input"
                    name="confirm"
                    type="password"
                    required
                    minLength={10}
                    autoComplete="new-password"
                  />
                </label>
                <label className="field">
                  <span className="label">
                    Backup passphrase (Google Drive owners only)
                  </span>
                  <input
                    className="input"
                    name="recovery"
                    type="password"
                    autoComplete="off"
                  />
                </label>
              </>
            ) : (
              <label className="field">
                <span className="label">Account email</span>
                <input
                  className="input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            )}
            <button className="btn btn-primary" disabled={busy || !ready}>
              {token ? "Set new password" : "Email reset link"}
            </button>
          </form>
        )}
        <p role="status">{status}</p>
        <Link href="/login">Back to sign in</Link>
      </section>
    </main>
  );
}
