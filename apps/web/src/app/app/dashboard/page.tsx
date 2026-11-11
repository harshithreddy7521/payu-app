"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getToken } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import type { DashboardStats } from "@fee/shared";

function fmt(paise: number) {
  return (
    "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })
  );
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

  if (loading)
    return (
      <div className="page">
        <div className="spinner" />
      </div>
    );
  if (error)
    return (
      <div className="page">
        <p className="error-msg">{error}</p>
      </div>
    );
  if (!stats) return null;

  const tiles = [
    {
      label: "Collected",
      value: fmt(stats.grossConfirmedPaise),
      color: "var(--success)",
    },
    {
      label: "Outstanding",
      value: fmt(stats.outstandingPaise),
      color: "var(--warn)",
    },
    {
      label: "Refunded",
      value: fmt(stats.refundedPaise),
      color: "var(--danger)",
    },
    {
      label: "Available",
      value: fmt(stats.availablePaise),
      color: "var(--primary)",
    },
    { label: "Held", value: fmt(stats.heldPaise), color: "var(--text-muted)" },
    { label: "Settled", value: fmt(stats.settledPaise), color: "var(--text)" },
  ];

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE BIG PICTURE, MADE CLEAR</p>
          <h1 className="page-title">
            A little clarity. A lot of possibility.
          </h1>
          <p className="page-subtitle">
            Your collections, balances, and progress in one calm place.
          </p>
        </div>
        <Link className="btn btn-primary" href="/app/quick-pay">
          + Quick Pay
        </Link>
      </div>
      <div
        style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}
      >
        Last 30 days · {stats.dateBasis.replace("_", " ").toLowerCase()}
      </div>
      <div className="stat-grid">
        {tiles.map((t) => (
          <div key={t.label} className="card stat-card">
            <div className="stat-label">{t.label}</div>
            <div className="stat-value" style={{ color: t.color }}>
              {t.value}
            </div>
            <p className="stat-foot">
              {t.label === "Outstanding"
                ? "Bills created in the reporting window"
                : "Ledger activity in the reporting window"}
            </p>
          </div>
        ))}
      </div>
      <div className="dashboard-bottom">
        <section className="card insight-panel">
          <p className="eyebrow">COLLECTION SNAPSHOT</p>
          <h3>Every payment is a step forward.</h3>
          <p>
            A comparison of confirmed collections and outstanding bill balances
            in the reporting window.
          </p>
          <div className="progress-track">
            <span
              style={{
                width: `${stats.grossConfirmedPaise + stats.outstandingPaise ? (100 * stats.grossConfirmedPaise) / (stats.grossConfirmedPaise + stats.outstandingPaise) : 0}%`,
              }}
            />
          </div>
          <div className="progress-legend">
            <span>● Confirmed {fmt(stats.grossConfirmedPaise)}</span>
            <span>Outstanding {fmt(stats.outstandingPaise)}</span>
          </div>
          <p style={{ marginTop: 20 }}>
            Collection totals use payment confirmation dates; outstanding
            balances use bill creation dates.
          </p>
        </section>
        <section
          className="hero-banner"
          style={{ marginBottom: 0, padding: 26 }}
        >
          <div>
            <span className="hero-pill">✦ Your next small step</span>
            <h2 style={{ fontSize: 24 }}>
              Build a rhythm.
              <br />
              <em>Let it flow.</em>
            </h2>
            <p>Bring members together and give recurring fees a routine.</p>
            <Link
              href="/app/groups"
              className="btn btn-primary"
              style={{ marginTop: 18 }}
            >
              Explore groups ↗
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
