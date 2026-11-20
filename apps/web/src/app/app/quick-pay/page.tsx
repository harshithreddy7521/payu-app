"use client";
import MemberPicker, { type PickedMember } from "@/components/MemberPicker";
import {
  payable,
  remaining,
  type BalanceBill,
} from "../../../../../mobile/src/local/memberBalance";
import { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import { whatsappPayment } from "../../../../../mobile/src/local/whatsapp";
import {
  upiUrl,
  validVpa,
  type SchoolProfile,
} from "../../../../../mobile/src/local/onboarding";
import { getToken, getUser, isDeviceWorkspace } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import type { QuickPayResponse, UserSummary } from "@fee/shared";
import { MessageChannel } from "@fee/shared";

type Branch = { id: string; name: string };

function shareableCheckout(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export default function QuickPayPage() {
  const [schoolQr, setSchoolQr] = useState("");
  const [schoolUpi, setSchoolUpi] = useState("");
  const local = isDeviceWorkspace();
  const restaurant = getUser()?.profile === "RESTAURANT";
  const requestRef = useRef<{ body: string; key: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [user, setUser] = useState<UserSummary | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [amount, setAmount] = useState("");
  const [member, setMember] = useState<PickedMember>();
  const [memberBills, setMemberBills] = useState<BalanceBill[]>([]);
  const [existingBillId, setExistingBillId] = useState("");
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<
    "" | "MANUAL_WHATSAPP" | MessageChannel
  >("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<
    | (QuickPayResponse & {
        qrCodeDataUrl?: string;
        upiIntentUrl?: string;
        whatsappUrl?: string;
      })
    | null
  >(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const u = getUser();
    setUser(u);
    if (!u) return;
    if (u.orgId === "local") {
      apiFetch<SchoolProfile>("/v1/local/profile", { token: getToken()! })
        .then(async (school) => {
          if (!validVpa(school.vpa)) return;
          const intent = upiUrl(school.vpa, school.name);
          setSchoolUpi(intent);
          setSchoolQr(await QRCode.toDataURL(intent));
        })
        .catch((e) => setError(e.message));
    }
    apiFetch<{ data: Branch[] }>("/v1/branches", { token: getToken()! })
      .then(({ data }) => {
        setBranches(data);
        if (data.length === 1) setBranchId(data[0].id);
        const selected = sessionStorage.getItem("fee_branch");
        if (selected && data.some((b) => b.id === selected))
          setBranchId(selected);
      })
      .catch((e) => setError(e.message));
  }, []);

  function chooseBill(bill?: BalanceBill) {
    setExistingBillId(bill?.id ?? "");
    if (!bill) {
      setPurpose("");
      setAmount("");
      return;
    }
    setPurpose(bill.purpose);
    setAmount(
      ((bill.amountPaise - bill.paidPaise || remaining(bill)) / 100).toFixed(2),
    );
  }

  useEffect(() => {
    setMemberBills([]);
    if (!local || !member) {
      setLoadingBalance(false);
      return;
    }
    let active = true;
    setLoadingBalance(true);
    void apiFetch<{ bills: BalanceBill[] }>(
      `/v1/members/${member.id}/balance`,
      { token: getToken()! },
    )
      .then(({ bills }) => {
        if (!active) return;
        const open = bills.filter(
          (bill) => payable(bill) && remaining(bill) > 0,
        );
        setMemberBills(open);
        const due = open.find((bill) => bill.amountPaise > bill.paidPaise);
        if (due) chooseBill(due);
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoadingBalance(false);
      });
    return () => {
      active = false;
    };
  }, [member, local]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResult(null);
    const paise = Math.round(parseFloat(amount) * 100);
    if (!paise || paise <= 0) {
      setError("Enter a valid amount");
      return;
    }
    if (loadingBalance) return;
    if (!branchId) {
      setError("Select a branch");
      return;
    }
    if (!restaurant && !purpose.trim()) {
      setError("Enter a purpose");
      return;
    }
    if (channel && (!consent || !/^(?:\+91)?[6-9]\d{9}$/.test(phone.trim()))) {
      setError("Enter a valid mobile number and confirm WhatsApp permission.");
      return;
    }
    setLoading(true);
    try {
      const fingerprint = JSON.stringify({
        amount,
        branchId,
        purpose,
        phone,
        channel,
        consent,
        memberId: member?.id,
        existingBillId,
      });
      if (requestRef.current?.body !== fingerprint)
        requestRef.current = { body: fingerprint, key: crypto.randomUUID() };
      const res = await apiFetch<
        QuickPayResponse & {
          qrCodeDataUrl?: string;
          upiIntentUrl?: string;
          whatsappUrl?: string;
        }
      >("/v1/quick-pay", {
        method: "POST",
        headers: { "Idempotency-Key": requestRef.current!.key },
        token: getToken()!,
        body: JSON.stringify({
          amountPaise: paise,
          branchId,
          purpose: purpose.trim() || "Counter payment",
          recipientPhone: phone.trim() || undefined,
          deliveryChannel:
            channel === "MANUAL_WHATSAPP" ? undefined : channel || undefined,
          deliveryConsent: consent,
          memberId: member?.id,
          existingBillId: existingBillId || undefined,
          isGuest: !member && !phone,
          ...(local ? { webOrigin: window.location.origin } : {}),
        }),
      });
      setResult(res);
      if (local && res.upiIntentUrl) {
        setResult({
          ...res,
          qrCodeDataUrl: await QRCode.toDataURL(res.upiIntentUrl),
        });
      } else if (res.paymentLinkToken) {
        const checkout = await apiFetch<{
          qrCodeDataUrl?: string;
          upiIntentUrl?: string;
        }>(`/pay/${res.paymentLinkToken}/checkout`, {
          method: "POST",
          body: JSON.stringify({}),
        }).catch(() => null);
        if (checkout?.qrCodeDataUrl)
          setResult((r) =>
            r
              ? {
                  ...r,
                  qrCodeDataUrl: checkout.qrCodeDataUrl,
                  upiIntentUrl: checkout.upiIntentUrl,
                  whatsappUrl:
                    channel === "MANUAL_WHATSAPP" &&
                    consent &&
                    checkout.upiIntentUrl
                      ? whatsappPayment(
                          phone.trim(),
                          checkout.upiIntentUrl,
                          purpose.trim(),
                          paise,
                          window.location.origin,
                        )
                      : undefined,
                }
              : r,
          );
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to create payment request",
      );
    } finally {
      setLoading(false);
    }
  }

  function copyLink() {
    if (!result) return;
    navigator.clipboard.writeText(result.checkoutUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function reset() {
    requestRef.current = null;
    setResult(null);
    setAmount("");
    setPurpose("");
    setPhone("");
    setMember(undefined);
    setExistingBillId("");
    setChannel("");
    setConsent(false);
  }

  if (result) {
    return (
      <div className="page">
        <div className="card form-card" style={{ maxWidth: 480 }}>
          <div className="form-title" style={{ color: "var(--success)" }}>
            ✓ Payment request created
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
            ₹{(parseFloat(amount) || 0).toLocaleString("en-IN")}
          </div>
          <div style={{ color: "var(--text-muted)", marginBottom: 20 }}>
            {purpose || "Counter payment"}
            {member && <div>{member.name}</div>}
          </div>

          {(local || shareableCheckout(result.checkoutUrl)) && (
            <div className="field">
              <div className="label">
                {local ? "Share payment link" : "Share link"}
              </div>
              <div
                className="link-box"
                onClick={copyLink}
                title="Click to copy"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && copyLink()}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {result.checkoutUrl}
                </span>
                <span style={{ color: "var(--primary)", flexShrink: 0 }}>
                  {copied ? "Copied!" : "Copy"}
                </span>
              </div>
            </div>
          )}

          {result.whatsappUrl && (
            <a
              className="btn btn-primary"
              href={result.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open WhatsApp to send
            </a>
          )}
          {result.upiIntentUrl && (
            <a className="btn btn-primary" href={result.upiIntentUrl}>
              Open UPI app
            </a>
          )}
          {result.qrCodeDataUrl && (
            <div className="qr-wrap">
              <img src={result.qrCodeDataUrl} alt="UPI QR code for payment" />
            </div>
          )}

          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}
          >
            {((restaurant && local) ||
              user?.roles.some((role) =>
                ["OWNER", "FINANCE"].includes(role),
              )) && (
              <a
                className="btn btn-ghost"
                href={
                  member
                    ? `/app/members?member=${encodeURIComponent(member.id)}&bill=${encodeURIComponent(result.billId)}&amountPaise=${Math.round(Number(amount) * 100)}`
                    : `/app/transactions?verify=${encodeURIComponent(result.billId)}`
                }
              >
                Record verified payment
              </a>
            )}
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={reset}
            >
              New request
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAKE ROOM FOR WHAT MATTERS</p>
          <h1 className="page-title">Let’s keep things flowing.</h1>
          <p className="page-subtitle">
            One simple request. A smoother way to get paid.
          </p>
        </div>
        <span className="badge badge-success">● Ready to collect</span>
      </div>
      <div className="hero-banner">
        <div>
          <span className="hero-pill">✦ A little less follow-up</span>
          <h2>
            Good things grow
            <br />
            with a <em>simpler flow.</em>
          </h2>
          <p>
            Create a payment link or counter QR in seconds. Your customers pay,
            their way.
          </p>
        </div>
        <img
          src="/collection-art.svg"
          alt="Illustration of a payment receipt with green leaves"
        />
      </div>
      <div className="quick-grid">
        <div>
          {local && (
            <section className="card form-card">
              <h2 className="form-title">Payment QR</h2>
              {schoolQr ? (
                <div className="qr-wrap">
                  <img src={schoolQr} alt="UPI payment QR" />
                  <a className="btn btn-ghost" href={schoolUpi}>
                    Open UPI app
                  </a>
                </div>
              ) : (
                <p>Set your workspace’s UPI address in Settings.</p>
              )}
            </section>
          )}
          <div className="card">
            <div className="section-heading">
              <div>
                <h2>Create a payment request</h2>
                <p>Start with an amount and a little context.</p>
              </div>
              <span className="section-tag">QUICK PAY</span>
            </div>
            <div className="form-card">
              <form onSubmit={handleSubmit}>
                {!restaurant && (
                  <MemberPicker
                    value={member}
                    onChange={(value) => {
                      if (existingBillId) chooseBill();
                      setLoadingBalance(Boolean(local && value));
                      setMember(value);
                    }}
                  />
                )}
                {local && member && loadingBalance && (
                  <p role="status">Loading member charges…</p>
                )}
                {local && member && memberBills.length > 0 && (
                  <label className="field">
                    <span className="label">Apply payment to</span>
                    <select
                      className="select"
                      value={existingBillId}
                      onChange={(event) =>
                        chooseBill(
                          memberBills.find(
                            (bill) => bill.id === event.target.value,
                          ),
                        )
                      }
                    >
                      <option value="">Create a new charge</option>
                      {memberBills.map((bill) => (
                        <option key={bill.id} value={bill.id}>
                          {bill.purpose} · ₹
                          {(remaining(bill) / 100).toLocaleString("en-IN")}{" "}
                          remaining
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="field">
                  <label className="label">Amount (₹)</label>
                  <div style={{ display: "flex", alignItems: "baseline" }}>
                    <span className="currency-prefix">₹</span>
                    <input
                      className="amount-input"
                      type="number"
                      min="1"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0"
                      required
                      autoFocus
                      aria-label="Amount in rupees"
                    />
                  </div>
                </div>

                {branches.length > 1 && (
                  <div className="field">
                    <label className="label">Branch</label>
                    <select
                      className="select"
                      value={branchId}
                      onChange={(e) => setBranchId(e.target.value)}
                      required
                    >
                      <option value="">Select branch</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="field">
                  <label className="label">Purpose / description</label>
                  <input
                    className="input"
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder={
                      restaurant
                        ? "e.g. Table 4"
                        : "e.g. Tuition fee — June 2026"
                    }
                    required={!restaurant}
                  />
                </div>

                <div className="field">
                  <label className="label">
                    Phone (optional — for WhatsApp/SMS)
                  </label>
                  <input
                    className="input"
                    type="tel"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      setConsent(false);
                      if (!e.target.value) setChannel("");
                    }}
                    placeholder="9876543210"
                  />
                </div>

                {phone && (
                  <div className="field">
                    <label className="label">Send via</label>
                    <select
                      className="select"
                      value={channel}
                      onChange={(e) =>
                        setChannel(
                          e.target.value as MessageChannel | "MANUAL_WHATSAPP",
                        )
                      }
                    >
                      <option value="">Display QR only</option>
                      {local ? (
                        <option value={MessageChannel.WHATSAPP}>
                          WhatsApp
                        </option>
                      ) : (
                        <>
                          <option value="MANUAL_WHATSAPP">
                            Open WhatsApp draft
                          </option>
                          <option value={MessageChannel.WHATSAPP}>
                            Queue WhatsApp via provider
                          </option>
                        </>
                      )}
                    </select>
                  </div>
                )}

                {phone && channel && (
                  <label style={{ display: "block", marginBottom: 16 }}>
                    <input
                      type="checkbox"
                      required
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />{" "}
                    The recipient agreed to receive WhatsApp payment messages.
                  </label>
                )}
                {error && (
                  <p className="error-msg" style={{ marginBottom: 12 }}>
                    {error}
                  </p>
                )}

                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={loading || loadingBalance}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  {loading ? (
                    <>
                      <span className="spinner" />
                      &nbsp;Creating…
                    </>
                  ) : (
                    "Create payment request"
                  )}
                </button>
              </form>
            </div>
          </div>
          <div className="trust-line">
            <span>◇ Secure checkout</span>
            <span>·</span>
            <span>Powered by UPI</span>
          </div>
        </div>
        <aside className="quick-aside">
          <p className="eyebrow">BIG ON SIMPLE</p>
          <h3>From request to receipt.</h3>
          <p>A thoughtful experience for you and the people who pay you.</p>
          <img
            src="/collection-art.svg"
            alt="A friendly illustrated payment card"
          />
          <ol className="steps">
            <li>
              <b>1</b>
              <div>
                <strong>Make it personal</strong>
                <small>Add an amount and a purpose.</small>
              </div>
            </li>
            <li>
              <b>2</b>
              <div>
                <strong>Share, or show</strong>
                <small>Send a link or display your QR.</small>
              </div>
            </li>
            <li>
              <b>3</b>
              <div>
                <strong>We’ll keep track</strong>
                <small>Verified payments, clear records.</small>
              </div>
            </li>
          </ol>
          <div className="notice">
            Guest at the counter? No phone number needed. Just scan and pay.
          </div>
        </aside>
      </div>
    </div>
  );
}
