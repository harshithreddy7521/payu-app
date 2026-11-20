"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";

export type PickedMember = {
  id: string;
  name: string;
  externalRef?: string | null;
};

export default function MemberPicker({
  value,
  onChange,
}: {
  value?: PickedMember;
  onChange: (member?: PickedMember) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<PickedMember[]>([]);
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (!open || value) return;
    let active = true;
    setStatus("Searching…");
    const timer = setTimeout(() => {
      void apiFetch<{ data: PickedMember[] }>(
        `/v1/members?lookup=1&limit=20&q=${encodeURIComponent(query)}`,
        { token: getToken()! },
      )
        .then(({ data }) => {
          if (!active) return;
          setMatches(data.slice(0, 20));
          setStatus(data.length ? "" : "No matching members.");
        })
        .catch((error: Error) => {
          if (active) setStatus(error.message);
        });
    }, 160);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, query, value]);
  return (
    <div className="field">
      <label className="label" htmlFor="quick-pay-member">
        Member (optional)
      </label>
      {value ? (
        <div>
          <strong>
            {value.name}
            {value.externalRef ? " · " + value.externalRef : ""}
          </strong>{" "}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              onChange();
              setQuery("");
              setOpen(false);
            }}
          >
            Clear member
          </button>
        </div>
      ) : (
        <>
          <input
            id="quick-pay-member"
            className="input"
            type="search"
            placeholder="Search by name, reference or phone"
            autoComplete="off"
            aria-expanded={open}
            aria-controls="quick-pay-member-results"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setMatches([]);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Escape") {
                event.preventDefault();
                if (event.key === "Escape") setOpen(false);
                else if (matches[0]) {
                  onChange(matches[0]);
                  setOpen(false);
                }
              }
            }}
          />
          {open && (
            <div
              id="quick-pay-member-results"
              style={{ maxHeight: 220, overflowY: "auto" }}
            >
              <p role="status">{status}</p>
              {matches.map((member) => (
                <button
                  type="button"
                  className="demo-login-button"
                  key={member.id}
                  onClick={() => {
                    onChange(member);
                    setOpen(false);
                  }}
                >
                  {member.name}
                  {member.externalRef ? " · " + member.externalRef : ""}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
