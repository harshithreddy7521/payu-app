"use client";
import { useEffect, useState } from "react";
import { getToken } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

type Group = { id: string; name: string; amountPaise: number; frequency: string; isActive: boolean; _count: { memberships: number } };

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ data: Group[] }>("/v1/groups", { token: getToken()! })
      .then((r) => setGroups(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page">
      <h1 className="page-title">Groups</h1>
      <div style={{ marginBottom: 16 }}>
        <a href="/app/groups/new" className="btn btn-primary">+ Create group</a>
      </div>
      {loading ? <div className="spinner" /> : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Amount</th><th>Frequency</th><th>Members</th><th>Status</th></tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>No groups yet</td></tr>
              )}
              {groups.map((g) => (
                <tr key={g.id}>
                  <td>{g.name}</td>
                  <td>₹{(g.amountPaise / 100).toLocaleString("en-IN")}</td>
                  <td>{g.frequency}</td>
                  <td>{g._count.memberships}</td>
                  <td><span className={`badge ${g.isActive ? "badge-success" : "badge-neutral"}`}>{g.isActive ? "Active" : "Inactive"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
