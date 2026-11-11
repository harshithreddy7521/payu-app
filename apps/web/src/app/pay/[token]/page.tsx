"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import type { CheckoutContext, CheckoutResponse } from "@fee/shared";

type PollStatus = "IDLE" | "PENDING" | "SUCCESS" | "FAILED";

export default function CheckoutPage() {
  const { token } = useParams<{ token: string }>();
  const [ctx, setCtx] = useState<CheckoutContext | null>(null);
  const [attempt, setAttempt] = useState<CheckoutResponse | null>(null);
  const [pollStatus, setPollStatus] = useState<PollStatus>("IDLE");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<CheckoutContext>(`/pay/${token}`)
      .then(setCtx)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function startCheckout() {
    if (!ctx) return;
    setError("");
    setPollStatus("PENDING");
    try {
      const res = await apiFetch<CheckoutResponse>(`/pay/${token}/checkout`, { method: "POST", body: JSON.stringify({}) });
      setAttempt(res);
      // Poll for confirmation
      pollAttempt(res.attemptId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start payment");
      setPollStatus("IDLE");
    }
  }

  function pollAttempt(attemptId: string) {
    let tries = 0;
    const id = setInterval(async () => {
      tries++;
      try {
        const res = await apiFetch<{ status: string }>(`/pay/${token}/attempt/${attemptId}`);
        if (res.status === "SUCCESS") { clearInterval(id); setPollStatus("SUCCESS"); }
        if (res.status === "FAILED") { clearInterval(id); setPollStatus("FAILED"); }
        if (tries > 60) { clearInterval(id); setPollStatus("IDLE"); } // 60s timeout
      } catch { clearInterval(id); }
    }, 1000);
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="spinner" />
    </div>
  );

  if (error || !ctx) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="card form-card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 32 }}>⚠️</div>
        <div style={{ marginTop: 12 }}>{error || "Payment link not found"}</div>
      </div>
    </div>
  );

  if (pollStatus === "SUCCESS") return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <div className="card form-card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48 }}>✅</div>
        <h2 style={{ marginTop: 12, color: "var(--success)" }}>Payment confirmed</h2>
        <div style={{ marginTop: 8, color: "var(--text-muted)" }}>
          ₹{(ctx.amountPaise / 100).toLocaleString("en-IN")} paid to {ctx.merchantName}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="card form-card" style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{ctx.merchantName}</div>
          <div style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>{ctx.purpose}</div>
        </div>

        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 36, fontWeight: 800 }}>₹{(ctx.remainingPaise / 100).toLocaleString("en-IN")}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            Expires {new Date(ctx.expiresAt).toLocaleString("en-IN")}
          </div>
        </div>

        {ctx.status !== "ACTIVE" && (
          <div style={{ background: "#fef3c7", color: "#92400e", padding: "10px 14px", borderRadius: "var(--radius)", marginBottom: 16, fontSize: 14 }}>
            This payment link is {ctx.status.toLowerCase()}.
          </div>
        )}

        {attempt?.qrCodeDataUrl && pollStatus === "PENDING" && (
          <div>
            <div className="qr-wrap">
              <img src={attempt.qrCodeDataUrl} alt="Scan to pay with any UPI app" />
            </div>
            <div style={{ textAlign: "center", fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
              Scan with any UPI app · waiting for confirmation…
            </div>
            {attempt.upiIntentUrl && (
              <a href={attempt.upiIntentUrl} className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginBottom: 8, textDecoration: "none" }}>
                Open UPI app
              </a>
            )}
          </div>
        )}

        {pollStatus === "IDLE" && ctx.status === "ACTIVE" && (
          <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={startCheckout}>
            Pay ₹{(ctx.remainingPaise / 100).toLocaleString("en-IN")} via UPI
          </button>
        )}

        {pollStatus === "FAILED" && (
          <div>
            <p className="error-msg" style={{ marginBottom: 12 }}>Payment failed. Please try again.</p>
            <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={startCheckout}>Retry</button>
          </div>
        )}

        <div style={{ marginTop: 20, fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
          Secured by FeeApp · UPI payments powered by provider
        </div>
      </div>
    </div>
  );
}
