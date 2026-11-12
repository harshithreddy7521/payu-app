"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { getToken, getUser, logout } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import Icon from "@/components/Icon";
import type { UserSummary } from "@fee/shared";
const NAV = [
  ["Quick Pay", "quick-pay", "pay"],
  ["Overview", "dashboard", "dashboard"],
  ["Members", "members", "members"],
  ["Groups & billing", "groups", "groups"],
  ["Reminders", "reminders", "reminders"],
  ["Transactions", "transactions", "transactions"],
  ["Settlements", "settlements", "settlements"],
  ["Settings", "settings", "settings"],
];
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter(),
    path = usePathname();
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [branch, setBranch] = useState("");
  const [user, setUser] = useState<UserSummary | null>(null),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    const u = getUser();
    if (!getToken() || !u) router.replace("/login");
    else setUser(u);
  }, [router]);
  useEffect(() => {
    if (!user) return;
    setBranch(sessionStorage.getItem("fee_branch") ?? "");
    apiFetch<{ data: { id: string; name: string }[] }>("/v1/branches", {
      token: getToken()!,
    })
      .then((r) => setBranches(r.data))
      .catch(() => {});
  }, [user]);
  if (!user)
    return (
      <div className="page" role="status">
        Opening your workspace…
      </div>
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <aside className={`sidebar ${menu ? "is-open" : ""}`}>
        <Link href="/app/quick-pay" className="brand">
          <span className="brand-mark">
            f<span>•</span>
          </span>
          fee<span className="brand-light">flow</span>
        </Link>
        <div className="workspace-card">
          <span className="workspace-avatar">{user.orgName.slice(0, 1)}</span>
          <div>
            <strong>{user.orgName}</strong>
            <small>{user.profile.toLowerCase()} workspace</small>
          </div>
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {NAV.filter(
            (n) =>
              !["reminders", "settlements"].includes(n[1]) ||
              user.roles.some((r) =>
                ["OWNER", "FINANCE", "BRANCH_MANAGER"].includes(r),
              ),
          ).map(([label, slug, icon]) => (
            <Link
              key={slug}
              href={`/app/${slug}`}
              onClick={() => setMenu(false)}
              aria-current={
                path.startsWith(`/app/${slug}`) ? "page" : undefined
              }
              className={`side-link ${path.startsWith(`/app/${slug}`) ? "active" : ""}`}
            >
              <Icon name={icon} />
              {label}
              {slug === "quick-pay" && <span className="nav-plus">+</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <span>✦</span>
          <strong>Small steps. Steady growth.</strong>
          <p>
            More time for your people.
            <br />
            Less time chasing payments.
          </p>
        </div>
        <button
          className="profile-button"
          onClick={() => {
            logout();
            router.push("/login");
          }}
        >
          <span className="user-avatar">{user.name.slice(0, 1)}</span>
          <span>
            <strong>{user.name}</strong>
            <small>Sign out</small>
          </span>
          <Icon name="logout" size={18} />
        </button>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <button
            className="menu-toggle btn btn-ghost"
            onClick={() => setMenu(!menu)}
            aria-label="Toggle navigation"
            aria-expanded={menu}
          >
            ☰
          </button>
          <span className="breadcrumb">
            Workspace <span>/</span>{" "}
            <strong>
              {NAV.find((n) => path.includes(n[1]))?.[0] ?? "Manage"}
            </strong>
          </span>
          <div className="topbar-end">
            <select
              className="branch-select"
              aria-label="Workspace branch"
              value={branch}
              onChange={(e) => {
                sessionStorage.setItem("fee_branch", e.target.value);
                setBranch(e.target.value);
                window.location.reload();
              }}
            >
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <span className="demo-indicator">
              <i /> Development workspace
            </span>
            <span className="user-avatar small">{user.name.slice(0, 1)}</span>
          </div>
        </header>
        <main id="content">{children}</main>
        <footer className="app-footer">
          Made for the people behind every growing organisation.
          <span>INR · Asia/Kolkata</span>
        </footer>
      </div>
    </div>
  );
}
