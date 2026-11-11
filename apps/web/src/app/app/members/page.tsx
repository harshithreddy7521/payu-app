"use client";
import { useEffect, useState } from "react";
import { getToken } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

type Member = { id: string; name: string; externalRef?: string; status: string; guardians: { name: string; phone: string }[] };

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    const token = getToken()!;
    apiFetch<{ data: Member[] }>(`/v1/members${q ? `?q=${encodeURIComponent(q)}` : ""}`, { token })
      .then((r) => setMembers(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [q]);

  return (
    <div className="page">
      <h1 className="page-title">Members</h1>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <a href="/app/members/new" className="btn btn-primary">+ Add member</a>
      </div>
      {loading ? <div className="spinner" /> : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Ref</th><th>Guardian</th><th>Phone</th><th>Status</th></tr>
            </thead>
            <tbody>
              {members.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>No members yet</td></tr>
              )}
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{m.externalRef ?? "—"}</td>
                  <td>{m.guardians[0]?.name ?? "—"}</td>
                  <td>{m.guardians[0]?.phone ?? "—"}</td>
                  <td><span className={`badge ${m.status === "ACTIVE" ? "badge-success" : "badge-neutral"}`}>{m.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
