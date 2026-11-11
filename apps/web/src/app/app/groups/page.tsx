"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { getToken } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
type Group = {
  id: string;
  name: string;
  amountPaise: number;
  frequency: string;
  isActive: boolean;
  billDayOfMonth: number | null;
  _count: { memberships: number };
};
export default function Groups() {
  const [groups, setGroups] = useState<Group[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    apiFetch<{ data: Group[] }>("/v1/groups", { token: getToken()! })
      .then((r) => setGroups(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">A RHYTHM THAT WORKS FOR YOU</p>
          <h1 className="page-title">Groups & recurring fees.</h1>
          <p className="page-subtitle">
            Set the rhythm once. Give every billing cycle a smoother start.
          </p>
        </div>
        <Link href="/app/groups/new" className="btn btn-primary">
          + Create group
        </Link>
      </div>
      <div className="hero-banner">
        <div>
          <span className="hero-pill">✦ Thoughtful automation</span>
          <h2>
            Less admin.
            <br />
            <em>More possibility.</em>
          </h2>
          <p>
            Monthly billing, individual member amounts, and reminders that know
            when to stop.
          </p>
        </div>
        <img src="/collection-art.svg" alt="Illustrated fee collection card" />
      </div>
      {error && (
        <p className="error-msg" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <div className="spinner" />
      ) : (
        <div className="group-grid">
          {groups.map((g) => (
            <Link
              href={`/app/groups/${g.id}`}
              className="card group-card"
              key={g.id}
            >
              <div className="group-card-top">
                <span className="group-icon">
                  <Icon name="groups" />
                </span>
                <span
                  className={`badge ${g.isActive ? "badge-success" : "badge-neutral"}`}
                >
                  {g.isActive ? "Active" : "Paused"}
                </span>
              </div>
              <h2>{g.name}</h2>
              <div className="price">
                ₹{(g.amountPaise / 100).toLocaleString("en-IN")}{" "}
                <small>
                  / {g.frequency === "MONTHLY" ? "month" : "one time"}
                </small>
              </div>
              <div className="group-card-footer">
                <span>{g._count.memberships} memberships</span>
                <span>
                  {g.billDayOfMonth ? `Day ${g.billDayOfMonth}` : "Month-end"}{" "}
                  <span aria-hidden="true">↗</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
      {!loading && !groups.length && (
        <div className="card empty-state">
          Every community starts with one group. Create yours above.
        </div>
      )}
    </div>
  );
}
