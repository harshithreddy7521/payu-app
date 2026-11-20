"use client";
import MemberPayments, { formatMoney } from "@/components/MemberPayments";
import type { MemberTotals } from "../../../../../mobile/src/local/memberBalance";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getToken, getUser, isDeviceWorkspace } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
type Member = {
  id: string;
  name: string;
  externalRef?: string;
  status: string;
  totals?: MemberTotals;
  feePaise?: number;
  hostelFeePaise?: number;
  concessionPercent?: number;
  guardians: {
    id: string;
    name: string;
    phone: string;
    whatsappConsentedAt: string | null;
    optOut: boolean;
  }[];
};
type ImportRow = {
  row: number;
  name: string;
  externalRef: string;
  phone: string;
  errors: string[];
};
export default function MembersPage() {
  const fees = isDeviceWorkspace() && getUser()?.profile !== "RESTAURANT";
  const owner = getUser()?.roles.some((role) =>
    ["OWNER", "BRANCH_MANAGER"].includes(role),
  );
  const [paymentMember, setPaymentMember] = useState<{
    id: string;
    name: string;
    bill?: string;
    amountPaise?: number;
  }>();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("member");
    if (id)
      setPaymentMember({
        id,
        name: params.get("name") || "Member",
        bill: params.get("bill") ?? undefined,
        amountPaise: Number(params.get("amountPaise")) || undefined,
      });
  }, []);
  const [feeMember, setFeeMember] = useState<Member>();
  const [concession, setConcession] = useState("");
  const [members, setMembers] = useState<Member[]>([]),
    [q, setQ] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [csv, setCsv] = useState(""),
    [rows, setRows] = useState<ImportRow[]>([]),
    [showImport, setShowImport] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [contact, setContact] = useState<{
    memberId: string;
    guardianId: string;
    optIn: boolean;
  } | null>(null);
  const [evidence, setEvidence] = useState("");
  async function saveConsent(e: React.FormEvent) {
    e.preventDefault();
    if (!contact) return;
    try {
      await apiFetch(
        `/v1/members/${contact.memberId}/guardians/${contact.guardianId}/whatsapp-consent`,
        {
          method: "PUT",
          token: getToken()!,
          body: JSON.stringify({ optIn: contact.optIn, evidence }),
        },
      );
      setContact(null);
      setEvidence("");
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function load() {
    setLoading(true);
    try {
      const r = await apiFetch<{ data: Member[] }>(
        `/v1/members?q=${encodeURIComponent(q)}`,
        { token: getToken()! },
      );
      setMembers(r.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [q]);
  async function importCsv(confirm = false) {
    setBusy(true);
    setError("");
    try {
      const r = await apiFetch<{ rows: ImportRow[]; imported: number }>(
        "/v1/members/import",
        {
          method: "POST",
          token: getToken()!,
          body: JSON.stringify({ csv, confirm }),
        },
      );
      setRows(r.rows);
      if (confirm) {
        setNotice(`${r.imported} members imported successfully.`);
        setShowImport(false);
        setRows([]);
        setCsv("");
        void load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function archive(id: string) {
    try {
      await apiFetch(`/v1/members/${id}/archive`, {
        method: "PATCH",
        token: getToken()!,
      });
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE PEOPLE BEHIND THE PAYMENTS</p>
          <h1 className="page-title">Your community.</h1>
          <p className="page-subtitle">
            One home for members, guardians, and the details that matter.
          </p>
        </div>
        <Link className="btn btn-primary" href="/app/members/new">
          + Add member
        </Link>
      </div>
      {error && (
        <p className="error-msg" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-msg" role="status">
          {notice}
        </p>
      )}
      {paymentMember && (
        <MemberPayments
          key={paymentMember.id}
          memberId={paymentMember.id}
          name={
            members.find((member) => member.id === paymentMember.id)?.name ??
            paymentMember.name
          }
          requestedBill={paymentMember.bill}
          requestedAmount={paymentMember.amountPaise}
          close={() => setPaymentMember(undefined)}
          onSaved={() => void load()}
        />
      )}
      {fees && feeMember && owner && (
        <form
          className="card form-card"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await apiFetch(`/v1/members/${feeMember.id}/fees`, {
                method: "PUT",
                token: getToken()!,
                body: JSON.stringify({ concessionPercent: Number(concession) }),
              });
              setFeeMember(undefined);
              setNotice("Concession saved.");
              await load();
            } catch (error) {
              setError((error as Error).message);
            }
          }}
        >
          <h2 className="form-title">{feeMember.name} · Concession</h2>
          <label className="field">
            <span className="label">Concession (%)</span>
            <input
              className="input"
              type="number"
              min="0"
              max="100"
              step="1"
              value={concession}
              onChange={(e) => setConcession(e.target.value)}
              required
            />
          </label>
          <button className="btn btn-primary">Save concession</button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => setFeeMember(undefined)}
          >
            Cancel
          </button>
        </form>
      )}
      {contact && (
        <form
          className="card form-card"
          onSubmit={saveConsent}
          style={{ marginBottom: 24 }}
        >
          <h2 className="form-title">
            {contact.optIn
              ? "Record WhatsApp permission"
              : "Withdraw WhatsApp permission"}
          </h2>
          <label className="label" htmlFor="consent-evidence">
            How was permission confirmed / withdrawn?
          </label>
          <textarea
            id="consent-evidence"
            className="input"
            required
            minLength={5}
            maxLength={500}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
          <button className="btn btn-primary">Save permission record</button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setContact(null)}
          >
            Cancel
          </button>
        </form>
      )}
      <div className="toolbar">
        <input
          className="input"
          aria-label="Search members"
          placeholder="Search your members…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className="btn btn-ghost"
          onClick={() => setShowImport(!showImport)}
        >
          ↑ Import CSV
        </button>
        <span
          style={{
            marginLeft: "auto",
            color: "var(--text-muted)",
            fontSize: 12,
          }}
        >
          {members.length} members shown
        </span>
      </div>
      {showImport && (
        <section
          className="card form-card form-wide"
          style={{ marginBottom: 24 }}
        >
          <h2 className="form-title">Bring your community along</h2>
          <p className="page-subtitle">
            Preview your file before importing. Siblings can share a guardian
            phone; each member needs a unique reference.
          </p>
          <label className="label" htmlFor="csv">
            CSV file (up to 500 rows)
          </label>
          <input
            id="csv"
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                setCsv(await f.text());
                setRows([]);
              }
            }}
          />
          <p className="notice">
            Required headers: name,externalRef,guardianName,phone
          </p>
          <button
            className="btn btn-ghost"
            disabled={!csv || busy}
            onClick={() => void importCsv()}
          >
            Preview import
          </button>
          {rows.length > 0 && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Name</th>
                      <th>Reference</th>
                      <th>Validation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.row}>
                        <td>{r.row}</td>
                        <td>{r.name}</td>
                        <td>{r.externalRef}</td>
                        <td>{r.errors.join(" · ") || "Ready to import"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="btn btn-primary"
                style={{ marginTop: 20 }}
                disabled={busy || rows.some((r) => r.errors.length > 0)}
                onClick={() => void importCsv(true)}
              >
                Confirm import of {rows.length} members
              </button>
            </>
          )}
        </section>
      )}
      {loading ? (
        <div className="spinner" role="status" aria-label="Loading members" />
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Reference</th>
                <th>Guardian</th>
                <th>Contact</th>
                <th>Paid</th>
                <th>Due now</th>
                <th>Total remaining</th>
                <th>Status</th>
                <th>Manage</th>
              </tr>
            </thead>
            <tbody>
              {!members.length && (
                <tr>
                  <td colSpan={9} className="empty-state">
                    Your community starts here. Add your first member.
                  </td>
                </tr>
              )}
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <span className="member-name">
                      <span className="member-dot">{m.name.slice(0, 1)}</span>
                      {m.name}
                      {fees && (
                        <div>
                          {m.feePaise
                            ? `₹${(m.feePaise / 100).toLocaleString("en-IN")} tuition · `
                            : ""}
                          {m.hostelFeePaise
                            ? `₹${(m.hostelFeePaise / 100).toLocaleString("en-IN")} hostel · `
                            : ""}
                          {m.concessionPercent ?? 0}% concession
                          {owner && (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => {
                                setFeeMember(m);
                                setConcession(String(m.concessionPercent ?? 0));
                              }}
                            >
                              Edit concession
                            </button>
                          )}
                        </div>
                      )}
                    </span>
                  </td>
                  <td>{m.externalRef || "—"}</td>
                  <td>{m.guardians[0]?.name || "—"}</td>
                  <td>
                    {m.guardians[0]?.phone.replace(/.(?=.{4})/g, "•") || "—"}
                  </td>
                  <td>{formatMoney(m.totals?.paidPaise ?? 0)}</td>
                  <td>{formatMoney(m.totals?.duePaise ?? 0)}</td>
                  <td>{formatMoney(m.totals?.remainingPaise ?? 0)}</td>
                  <td>
                    <span className="badge badge-success">Active</span>
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => {
                        setPaymentMember({ id: m.id, name: m.name });
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Payments
                    </button>
                    {m.guardians[0] && (
                      <button
                        className="btn btn-ghost"
                        onClick={() => {
                          setContact({
                            memberId: m.id,
                            guardianId: m.guardians[0].id,
                            optIn:
                              !m.guardians[0].whatsappConsentedAt ||
                              m.guardians[0].optOut,
                          });
                          setEvidence("");
                        }}
                      >
                        {m.guardians[0].whatsappConsentedAt &&
                        !m.guardians[0].optOut
                          ? "Withdraw WhatsApp permission"
                          : "Record WhatsApp permission"}
                      </button>
                    )}
                    <button
                      className="btn btn-ghost"
                      onClick={() => void archive(m.id)}
                      aria-label={`Archive ${m.name}`}
                    >
                      Archive
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
