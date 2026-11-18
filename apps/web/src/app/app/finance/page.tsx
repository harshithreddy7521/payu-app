"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken, getUser } from "@/lib/auth";
type Destination = {
  id: string;
  maskedValue: string;
  ifsc: string;
  status: string;
  requestedBy: string;
};
type Refund = {
  id: string;
  amountPaise: number;
  reason: string;
  status: string;
  requestedBy: string;
  approvedBy: string | null;
};
export default function Finance() {
  const [destinations, setDestinations] = useState<Destination[]>([]),
    [refunds, setRefunds] = useState<Refund[]>([]),
    [lastFour, setLastFour] = useState(""),
    [ifsc, setIfsc] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      const [d, r] = await Promise.all([
        apiFetch<{ data: Destination[] }>("/v1/destinations", {
          token: getToken()!,
        }),
        apiFetch<{ data: Refund[] }>("/v1/refunds", { token: getToken()! }),
      ]);
      setDestinations(d.data);
      setRefunds(r.data);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function action(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await apiFetch(path, {
        method: "POST",
        token: getToken()!,
        body: JSON.stringify(body),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <h1 className="page-title">Finance review</h1>
      <p className="notice">
        Review is separate from verification or execution. No payout or refund
        is sent here. Beneficiary verification and payment-provider integration
        are still required.
      </p>
      {error && (
        <p role="alert" className="error-msg">
          {error}
        </p>
      )}
      {getUser()?.roles.some((r) => r === "OWNER") && (
        <form
          className="card form-card"
          onSubmit={(e) => {
            e.preventDefault();
            void action("/v1/destinations", { lastFour, ifsc });
          }}
        >
          <h2 className="form-title">Request bank destination review</h2>
          <label className="label" htmlFor="last-four">
            Account last four digits
          </label>
          <input
            className="input"
            id="last-four"
            pattern="[0-9]{4}"
            maxLength={4}
            required
            value={lastFour}
            onChange={(e) => setLastFour(e.target.value)}
          />
          <label className="label" htmlFor="ifsc">
            IFSC
          </label>
          <input
            className="input"
            id="ifsc"
            required
            value={ifsc}
            onChange={(e) => setIfsc(e.target.value.toUpperCase())}
          />
          <button className="btn btn-primary" disabled={busy}>
            Request review
          </button>
        </form>
      )}
      <h2 className="form-title" style={{ marginTop: 30 }}>
        Destination requests
      </h2>
      {!destinations.length && <p>No requests.</p>}
      {destinations.map((d) => (
        <section className="card insight-panel" key={d.id}>
          <strong>
            {d.maskedValue} · {d.ifsc}
          </strong>
          <p>{d.status}</p>
          <p>Not provider-verified; payouts disabled.</p>
          {d.status === "REQUESTED" && d.requestedBy !== getUser()?.id && (
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() =>
                void action(`/v1/destinations/${d.id}/approve`, {})
              }
            >
              Approve review
            </button>
          )}
        </section>
      ))}
      <h2 className="form-title" style={{ marginTop: 30 }}>
        Refund requests
      </h2>
      {!refunds.length && <p>No requests.</p>}
      {refunds.map((r) => (
        <section className="card insight-panel" key={r.id}>
          <strong>
            ₹{(r.amountPaise / 100).toFixed(2)} · {r.status}
          </strong>
          <p>{r.reason}</p>
          <p>
            {r.approvedBy
              ? "Reviewed; awaiting provider execution"
              : "Awaiting independent review"}
          </p>
          {r.status === "REQUESTED" &&
            !r.approvedBy &&
            r.requestedBy !== getUser()?.id && (
              <button
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => void action(`/v1/refunds/${r.id}/approve`, {})}
              >
                Approve refund review
              </button>
            )}
        </section>
      ))}
    </div>
  );
}
