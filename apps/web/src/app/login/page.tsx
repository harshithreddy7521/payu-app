"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      router.push("/app/quick-pay");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <div className="card form-card" style={{ width: "100%", maxWidth: 400 }}>
        <div className="form-title">
          <span style={{ color: "var(--primary)", fontWeight: 800 }}>FeeApp</span>
          <div style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)", marginTop: 4 }}>Sign in to your account</div>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label className="label" htmlFor="password">Password</label>
            <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="error-msg" style={{ marginBottom: 12 }}>{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "100%", justifyContent: "center" }}>
            {loading ? <span className="spinner" /> : "Sign in"}
          </button>
        </form>
        <div style={{ marginTop: 20, fontSize: 12, color: "var(--text-muted)", borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <strong>Demo logins:</strong><br />
          school.owner@demo.com / Demo1234!<br />
          sports.owner@demo.com / Demo1234!<br />
          restaurant.owner@demo.com / Demo1234!
        </div>
      </div>
    </div>
  );
}
