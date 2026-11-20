"use client";
import EnrollmentFields, {
  defaultEnrollment,
} from "@/components/EnrollmentFields";
import type { FeePlan } from "../../../../../../mobile/src/local/feePlans";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { rupeesToPaise } from "../../../../../../mobile/src/lib/validation";
import { getToken, getUser, isDeviceWorkspace } from "@/lib/auth";
export default function NewMember() {
  const router = useRouter();
  const school = isDeviceWorkspace() && getUser()?.profile === "SCHOOL";
  const plannedProfile =
    isDeviceWorkspace() &&
    ["SCHOOL", "SPORTS"].includes(getUser()?.profile ?? "");
  const [groups, setGroups] = useState<
    { id: string; name: string; feePlan?: FeePlan; isActive: boolean }[]
  >([]);
  const [groupId, setGroupId] = useState("");
  const [enrollment, setEnrollment] = useState(defaultEnrollment);
  const selectedPlan = groups.find((group) => group.id === groupId)?.feePlan;
  useEffect(() => {
    if (plannedProfile)
      void apiFetch<{ data: typeof groups }>("/v1/groups", {
        token: getToken()!,
      })
        .then(({ data }) =>
          setGroups(data.filter((group) => group.isActive && group.feePlan)),
        )
        .catch((e) => setError(e.message));
  }, [plannedProfile]);
  const [tuition, setTuition] = useState("");
  const [fixedFee, setFixedFee] = useState<number>();
  useEffect(() => {
    if (!school) return;
    apiFetch<{ standardFeePaise?: number }>("/v1/local/profile", {
      token: getToken()!,
    })
      .then((profile) => setFixedFee(profile.standardFeePaise))
      .catch(() => {});
  }, [school]);
  const [hostel, setHostel] = useState("");
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
          ...(groupId ? { groupId, ...enrollment } : {}),
          ...(school && !groupId
            ? {
                feePaise: tuition ? rupeesToPaise(tuition) : undefined,
                hostelFeePaise:
                  hostel && Number(hostel) ? rupeesToPaise(hostel) : 0,
              }
            : {}),
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
        {plannedProfile && (
          <label className="field">
            <span className="label">{school ? "Class" : "Program"}</span>
            <select
              className="select"
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value);
                setEnrollment(defaultEnrollment);
              }}
            >
              <option value="">Enroll later</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {selectedPlan && (
          <EnrollmentFields
            plan={selectedPlan}
            value={enrollment}
            onChange={setEnrollment}
          />
        )}
        {school && !selectedPlan && groups.length === 0 && (
          <>
            <label className="field">
              <span className="label">
                Total tuition fee before concession (₹)
              </span>
              <input
                className="input"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Use group fee"
                readOnly={fixedFee !== undefined}
                value={
                  fixedFee === undefined ? tuition : (fixedFee / 100).toFixed(2)
                }
                onChange={(e) => setTuition(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="label">Hostel fee (₹, optional)</span>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={hostel}
                onChange={(e) => setHostel(e.target.value)}
              />
            </label>
          </>
        )}
        {[
          ["Member name", name, setName],
          ["Admission / member reference", ref, setRef],
          [school ? "Guardian name" : "Contact name", guardian, setGuardian],
          [school ? "Guardian mobile" : "Contact mobile", phone, setPhone],
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
                ((label === "Guardian name" || label === "Contact name") &&
                  !!phone)
              }
              pattern={
                label === "Guardian mobile" || label === "Contact mobile"
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
