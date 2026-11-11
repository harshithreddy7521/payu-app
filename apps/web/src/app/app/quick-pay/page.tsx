"use client";
import { useState, useEffect } from "react";
import { getToken, getUser } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import type { QuickPayResponse, UserSummary } from "@fee/shared";
import { MessageChannel } from "@fee/shared";

type Branch = { id: string; name: string };

export default function QuickPayPage() {
  const [user, setUser] = useState<UserSummary | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<"" | MessageChannel>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QuickPayResponse & { qrCodeDataUrl?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const u = getUser(); setUser(u);
    if (!u) return;
    // Fetch branches
    apiFetch<{ data: Branch[] }>("/v1/transactions", { token: getToken()! })
      .catch(() => null);
    // For demo: derive branches from seed data
    const demoBranches: Record<string, Branch[]> = {
      "demo-school": [{ id: "school-main", name: "Main Campus" }],
      "demo-sports": [{ id: "sports-main", name: "Academy Ground" }],
      "demo-restaurant": [{ id: "rest-main", name: "MG Road Outlet" }],
    };
    const b = demoBranches[u.orgId] ?? [];
    setBranches(b);
    if (b.length === 1) setBranchId(b[0].id);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setResult(null);
    const paise = Math.round(parseFloat(amount) * 100);
    if (!paise || paise <= 0) { setError("Enter a valid amount"); return; }
    if (!branchId) { setError("Select a branch"); return; }
    if (!purpose.trim()) { setError("Enter a purpose"); return; }
    setLoading(true);
    try {
      const res = await apiFetch<QuickPayResponse & { qrCodeDataUrl?: string }>("/v1/quick-pay", {
        method: "POST", token: getToken()!,
        body: JSON.stringify({
          amountPaise: paise, branchId, purpose: purpose.trim(),
          recipientPhone: phone || undefined,
          deliveryChannel: channel || undefined,
          isGuest: !phone,
        }),
      });
      setResult(res);
      // Fetch QR from checkout
      if (res.paymentLinkToken) {
        const checkout = await apiFetch<{ qrCodeDataUrl?: string }>(
          `/pay/${res.paymentLinkToken}/checkout`, { method: "POST", body: JSON.stringify({}) }
        ).catch(() => null);
        if (checkout?.qrCodeDataUrl) setResult((r) => r ? { ...r, qrCodeDataUrl: checkout.qrCodeDataUrl } : r);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create payment request");
    } finally {
      setLoading(false);
    }
  }

  function copyLink() {
    if (!result) return;
    navigator.clipboard.writeText(result.checkoutUrl);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  function reset() { setResult(null); setAmount(""); setPurpose(""); setPhone(""); setChannel(""); }

  if (result) {
    return (
      <div className="page">
        <div className="card form-card" style={{ maxWidth: 480 }}>
          <div className="form-title" style={{ color: "var(--success)" }}>✓ Payment request created</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
            ₹{(parseInt(amount) || 0).toLocaleString("en-IN")}
          </div>
          <div style={{ color: "var(--text-muted)", marginBottom: 20 }}>{purpose}</div>

          <div className="field">
            <div className="label">Share link</div>
            <div className="link-box" onClick={copyLink} title="Click to copy" role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && copyLink()}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{result.checkoutUrl}</span>
              <span style={{ color: "var(--primary)", flexShrink: 0 }}>{copied ? "Copied!" : "Copy"}</span>
            </div>
          </div>

          {result.qrCodeDataUrl && (
            <div className="qr-wrap">
              <img src={result.qrCodeDataUrl} alt="UPI QR code for payment" />
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={reset}>New request</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">Quick Pay</h1>
      <div className="card form-card">
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label className="label">Amount (₹)</label>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <span className="currency-prefix">₹</span>
              <input
                className="amount-input"
                type="number" min="1" step="0.01"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0" required autoFocus
                aria-label="Amount in rupees"
              />
            </div>
          </div>

          {branches.length > 1 && (
            <div className="field">
              <label className="label">Branch</label>
              <select className="select" value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
                <option value="">Select branch</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}

          <div className="field">
            <label className="label">Purpose / description</label>
            <input className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Tuition fee — June 2026" required />
          </div>

          <div className="field">
            <label className="label">Phone (optional — for WhatsApp/SMS)</label>
            <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9876543210" />
          </div>

          {phone && (
            <div className="field">
              <label className="label">Send via</label>
              <select className="select" value={channel} onChange={(e) => setChannel(e.target.value as MessageChannel)}>
                <option value="">Display QR only</option>
                <option value={MessageChannel.WHATSAPP}>WhatsApp</option>
                <option value={MessageChannel.SMS}>SMS</option>
              </select>
            </div>
          )}

          {error && <p className="error-msg" style={{ marginBottom: 12 }}>{error}</p>}

          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "100%", justifyContent: "center" }}>
            {loading ? <><span className="spinner" />&nbsp;Creating…</> : "Create payment request"}
          </button>
        </form>
      </div>
    </div>
  );
}
