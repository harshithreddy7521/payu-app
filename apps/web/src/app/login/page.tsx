"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/auth";
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      router.push("/app/quick-pay");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in");
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="login-screen">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">
            f<span>•</span>
          </span>
          fee<span className="brand-light">flow</span>
        </div>
        <h1>
          Less chasing.
          <br />
          More <em>growing.</em>
        </h1>
        <p>
          Thoughtful fee collection for the schools, academies, and businesses
          moving India forward.
        </p>
        <img
          src="/collection-art.svg"
          alt="Illustrated payment receipt surrounded by greenery"
        />
        <div className="login-story-footer">
          Built around your people. Designed for your peace of mind.
        </div>
      </section>
      <section className="login-form-panel">
        <div>
          <p className="eyebrow">YOUR DAY, A LITTLE SIMPLER</p>
          <h2>Welcome back.</h2>
          <p className="intro">
            Sign in to your workspace and keep things flowing.
          </p>
          <form onSubmit={submit}>
            <div className="field">
              <label className="label" htmlFor="email">
                Work email
              </label>
              <input
                id="email"
                className="input"
                type="email"
                placeholder="you@organisation.com"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                className="input"
                type="password"
                placeholder="Enter your password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="error-msg" role="alert">
                {error}
              </p>
            )}
            <button
              className="btn btn-primary"
              style={{ width: "100%" }}
              disabled={loading}
            >
              {loading ? "Signing in…" : "Sign in to workspace →"}
            </button>
          </form>
          <div className="demo-logins">
            <strong>Take a look around</strong>
            <p style={{ marginTop: 6 }}>
              Explore a sample workspace. UPI links use the configured recipient.
            </p>
            {[
              ["school", "School & education"],
              ["sports", "Sports academy"],
              ["restaurant", "Restaurant"],
            ].map(([id, label]) => (
              <button
                key={id}
                className="demo-login-button"
                onClick={() => {
                  setEmail(`${id}.owner@demo.com`);
                  setPassword("Demo1234!");
                }}
              >
                {label}
                <span>Try demo ↗</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
