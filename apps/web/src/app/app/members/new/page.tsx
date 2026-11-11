"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";
export default function NewMember() {
  const router = useRouter();
  const [name, setName] = useState(""),
    [ref, setRef] = useState(""),
    [guardian, setGuardian] = useState(""),
    [phone, setPhone] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiFetch("/v1/members", {
        method: "POST",
        token: getToken()!,
        body: JSON.stringify({
          name,
          externalRef: ref || undefined,
          guardians: phone ? [{ name: guardian, phone }] : [],
        }),
      });
      router.push("/app/members");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <p className="eyebrow">GROW YOUR COMMUNITY</p>
      <h1 className="page-title">A new face. A warm welcome.</h1>
      <p className="page-subtitle">
        Keep each member’s fees separate, even when guardians are shared.
      </p>
      <form className="card form-card form-wide" onSubmit={submit}>
        {[
          ["Member name", name, setName],
          ["Admission / member reference", ref, setRef],
          ["Guardian name", guardian, setGuardian],
          ["Guardian mobile", phone, setPhone],
        ].map(([label, value, setter]) => (
          <div className="field" key={label as string}>
            <label className="label" htmlFor={label as string}>
              {label as string}
            </label>
            <input
              id={label as string}
              className="input"
              value={value as string}
              onChange={(e) => (setter as (s: string) => void)(e.target.value)}
              required={
                label === "Member name" ||
                (label === "Guardian name" && !!phone)
              }
              pattern={
                label === "Guardian mobile"
                  ? "(\\+91)?[6-9][0-9]{9}"
                  : undefined
              }
            />
          </div>
        ))}
        <p className="notice">
          Contacts start as unverified. Only add a guardian with permission to
          receive fee messages.
        </p>
        {error && (
          <p className="error-msg" role="alert">
            {error}
          </p>
        )}
        <div className="toolbar">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Add member"}
          </button>
          <Link className="btn btn-ghost" href="/app/members">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
