"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { getToken, getUser, logout } from "@/lib/auth";
import type { UserSummary } from "@fee/shared";

const NAV = [
  { label: "Quick Pay", href: "/app/quick-pay" },
  { label: "Dashboard", href: "/app/dashboard" },
  { label: "Members", href: "/app/members" },
  { label: "Groups", href: "/app/groups" },
  { label: "Transactions", href: "/app/transactions" },
  { label: "Settlements", href: "/app/settlements" },
  { label: "Settings", href: "/app/settings" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [user, setUser] = useState<UserSummary | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const token = getToken();
    const u = getUser();
    if (!token || !u) { router.replace("/login"); return; }
    setUser(u);
  }, [router]);

  if (!user) return null;

  return (
    <div>
      <nav className="nav" role="navigation" aria-label="Main navigation">
        <span className="nav-logo">FeeApp</span>
        {/* Desktop nav */}
        <div style={{ display: "flex", gap: 2 }} className="desktop-nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`nav-link${path.startsWith(n.href) ? " active" : ""}`}>
              {n.label}
            </Link>
          ))}
        </div>
        <div className="nav-end">
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{user.orgName}</span>
          <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 13 }} onClick={() => { logout(); router.push("/login"); }}>
            Sign out
          </button>
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}
