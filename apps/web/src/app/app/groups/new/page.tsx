"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";
type Cycle = {
  issueDate: string;
  dueDate: string;
  amountPaise: number;
  reminders: string[];
};
export default function NewGroup() {
  const router = useRouter();
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]),
    [branchId, setBranch] = useState(""),
    [name, setName] = useState(""),
    [amount, setAmount] = useState(""),
    [day, setDay] = useState("1"),
    [due, setDue] = useState("7"),
    [end, setEnd] = useState(""),
    [cycles, setCycles] = useState<Cycle[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    apiFetch<{ data: { id: string; name: string }[] }>("/v1/branches", {
      token: getToken()!,
    })
      .then((r) => {
        setBranches(r.data);
        setBranch(r.data[0]?.id || "");
      })
      .catch((e) => setError(e.message));
  }, []);
  function body() {
    return {
      name,
      branchId,
      amountPaise: Math.round(Number(amount) * 100),
      frequency: "MONTHLY",
      billDayOfMonth: day ? Number(day) : null,
      dueDayOffset: Number(due),
      endsAt: end ? new Date(`${end}T23:59:00+05:30`).toISOString() : undefined,
    };
  }
  async function preview(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await apiFetch<{ cycles: Cycle[] }>("/v1/groups/preview", {
        method: "POST",
        token: getToken()!,
        body: JSON.stringify(body()),
      });
      setCycles(r.cycles);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const r = await apiFetch<{ id: string }>("/v1/groups", {
        method: "POST",
        token: getToken()!,
        body: JSON.stringify(body()),
      });
      router.push(`/app/groups/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <p className="eyebrow">SET YOUR OWN RHYTHM</p>
      <h1 className="page-title">A smoother billing cycle.</h1>
      <p className="page-subtitle">
        Preview the next three cycles before you create your group. All dates
        follow India Standard Time.
      </p>
      <form
        className="card form-card form-wide"
        onSubmit={preview}
        onChange={() => setCycles([])}
      >
        <div className="field">
          <label className="label" htmlFor="group-name">
            Group name
          </label>
          <input
            id="group-name"
            className="input"
            placeholder="e.g. Class 6 · Tuition"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="form-row">
          <div className="field">
            <label className="label" htmlFor="branch">
              Branch
            </label>
            <select
              id="branch"
              className="select"
              value={branchId}
              onChange={(e) => setBranch(e.target.value)}
              required
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="fee">
              Monthly fee (₹)
            </label>
            <input
              id="fee"
              className="input"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label className="label" htmlFor="day">
              Issue bills on
            </label>
            <select
              id="day"
              className="select"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            >
              <option value="">Last day of month</option>
              {Array.from({ length: 31 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Day {i + 1}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="due">
              Days until due
            </label>
            <input
              id="due"
              type="number"
              className="input"
              min="0"
              max="90"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="end">
              End date (optional)
            </label>
            <input
              id="end"
              type="date"
              className="input"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>
        <p className="notice">
          Days 29–31 clamp to month-end. New members start at the next eligible
          cycle. Reminders default to −3, 0, and +3 days at 10:00 IST.
        </p>
        {error && (
          <p className="error-msg" role="alert">
            {error}
          </p>
        )}
        <div className="toolbar">
          <button className="btn btn-ghost" disabled={busy}>
            Preview next 3 cycles
          </button>
          <Link href="/app/groups" className="btn btn-ghost">
            Cancel
          </Link>
        </div>
        {cycles.length > 0 && (
          <>
            <div className="cycle-grid">
              {cycles.map((c) => (
                <div className="cycle-card" key={c.issueDate}>
                  <small>BILL ISSUED</small>
                  <strong>{c.issueDate}</strong>
                  <p>Due {c.dueDate}</p>
                  <p>₹{(c.amountPaise / 100).toLocaleString("en-IN")}</p>
                </div>
              ))}
            </div>
            <button
              style={{ marginTop: 24 }}
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void save()}
            >
              Confirm & create group
            </button>
          </>
        )}
      </form>
    </div>
  );
}
