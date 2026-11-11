"use client";
import { useEffect, useState } from "react";
import { getToken } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import type { DashboardStats } from "@fee/shared";

function fmt(paise: number) {
  return "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<DashboardStats>("/v1/dashboard", { token: getToken()! })
      .then(setStats)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page"><div className="spinner" /></div>;
  if (error) return <div className="page"><p className="error-msg">{error}</p></div>;
  if (!stats) return null;

  const tiles = [
    { label: "Collected", value: fmt(stats.grossConfirmedPaise), color: "var(--success)" },
    { label: "Outstanding", value: fmt(stats.outstandingPaise), color: "var(--warn)" },
    { label: "Refunded", value: fmt(stats.refundedPaise), color: "var(--danger)" },
    { label: "Available", value: fmt(stats.availablePaise), color: "var(--primary)" },
    { label: "Held", value: fmt(stats.heldPaise), color: "var(--text-muted)" },
    { label: "Settled", value: fmt(stats.settledPaise), color: "var(--text)" },
  ];

  return (
    <div className="page">
      <h1 className="page-title">Dashboard</h1>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        Last 30 days · {stats.dateBasis.replace("_", " ").toLowerCase()}
      </div>
      <div className="stat-grid">
        {tiles.map((t) => (
          <div key={t.label} className="card stat-card">
            <div className="stat-label">{t.label}</div>
            <div className="stat-value" style={{ color: t.color }}>{t.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
