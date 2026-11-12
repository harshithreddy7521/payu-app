# Implementation progress against requirements v1.0

The uploaded specification is the product baseline. This increment implements the
next local-demo stage: members, recurring groups, reminders, and a redesigned web
workspace. Payment and message adapters remain fake; real-provider capabilities
are not represented as verified or production-ready.

## Delivered in this increment

- Responsive Feeflow web design: emerald/ivory palette, custom local SVG artwork,
  sidebar navigation, mobile menu, accessible labels, keyboard focus, skip link,
  calmer forms, group cards, dashboard panels, and visible error states.
- Persistent branch selector scopes groups, dashboard, transactions and reminders.
  The API independently checks tenant and branch scope for these operations.
- Member creation, search, archival, masked contacts, and CSV preview/confirmation.
  CSV supports quoted fields and row validation, up to 500 rows. References are
  checked within the organisation and committed atomically. Siblings may share
  a guardian phone. Archival retains bills and prevents future recurring billing.
- Monthly groups, amount overrides, next-three-cycle previews, group end dates,
  pause/resume, enrollment and removal. New joins start at the next eligible
  cycle; February and fixed days 29–31 clamp to month-end in Asia/Kolkata.
- A separate worker polls PostgreSQL every 30 seconds. An advisory lock per
  organisation and a unique membership/period index prevent duplicate bills.
  Bills snapshot amount, purpose, due date, member and billing period.
- Durable reminder occurrences with default −3/0/+3 offsets at 10:00 IST,
  English/Hindi metadata and channel ordering. Policy changes suppress old
  queued occurrences and rebuild future occurrences for existing payable bills.
- Dispatch checks remaining balance, member status, guardian linkage and opt-out,
  revoked links, a ten-minute pending-payment grace period, quiet hours
  (08:00–20:00 IST) and a cap of three sends per shared recipient per 24 hours.
  Expired links are replaced under the same bill. Manual resend is audited and
  deduplicated against queued or unknown sends.
- A send is durably marked UNKNOWN before contacting the adapter. An interrupted
  send cannot be replayed automatically. Confirmed final WhatsApp failure queues
  one SMS fallback if the policy allows it; unknown results do not fall back.
- Readable delivery history, queued/submitted/suppressed counts, an owner-only
  billing catch-up action, and CSV export of visible transaction rows. CSV export
  excludes member contacts and escapes spreadsheet formula prefixes.
- Public, token-scoped confirmed-payment receipts with masked references and
  printing. Reusing a pending demo checkout returns its QR/Intent details.
- DATABASE_URL now comes from the environment. An additive SQL upgrade is
  included for existing Phase 1 databases.

## Local validation

```sh
npm run build --workspace=@fee/api
npm run build --workspace=@fee/web
npm run build --workspace=@fee/shared
npm test --workspace=@fee/api
# Optional: uses the configured local PostgreSQL database and cleans its fixtures.
cd apps/api
RUN_DB_TESTS=1 npm test
```

Tests cover IST rollover, leap years, month-end, mid-cycle joining, expiry,
quoted CSV, duplicate references, siblings, concurrent billing and dispatch,
paid/opted-out suppression, quiet hours, final-failure fallback and unknown
outcome deduplication. Browser checks cover login, member creation, group
preview/create/enrollment, policy editing, navigation, and a 390px mobile view.
HTTP checks cover import preview/commit, duplicates, invalid input, unauthenticated
billing and direct cross-tenant group access.

## Remaining specification work

This increment does not complete every P0 acceptance criterion:

1. Members/billing: arbitrary CSV column mapping, effective-dated rule versions,
   explicit current-cycle enrollment/adjustments, membership request-body
   idempotency, replay/backfill across missed months and deep pagination UI.
2. Messaging: provider status lookup/webhooks, transient-error retry/backoff,
   contact permission evidence and self-service opt-out, registered production
   templates, per-tenant configurable quiet hours/caps, and automated resolution
   of UNKNOWN delivery. The fake provider reports SUBMITTED, never DELIVERED.
3. Payments: durable fake orders across API restarts, full idempotency across
   order/delivery creation, signed webhook inbox/outbox, partial-payment
   reservations, excess/unapplied funds and complete concurrency/reconciliation
   acceptance tests. Existing fake polling is for local demonstration.
4. Phase 3: verified destination onboarding, MFA/maker-checker/cooling periods,
   approved refunds, durable settlement reservation and daily 02:00 IST batch,
   timeout/return recovery, reconciliation and an operations exception queue.
   Existing settlement/refund scaffold is not an end-to-end implementation.
5. Phase 4: select payment/messaging partners, connect their sandbox credentials,
   test Android/iOS/embedded-browser matrix, backup restore/failure drills,
   monitoring, provider approvals and staged live rollout. Live adapters fail
   closed until implemented; no real payment or messaging service is connected.
6. Mobile surfaces still use the existing Expo scaffold. This increment updates
   the responsive web application; native parity remains a separate stage.

The existing dashboard is an operational summary, not a reconciled statement of
provider-available funds. The UI labels its differing bill and ledger date bases.

## Temporary direct-UPI reconciliation increment

Direct UPI now supports an owner/finance-only **Record verified payment** flow.
Payments persist `source=MANUAL_UPI`, the verifier, received timestamp, method,
note, and a unique normalised reference. Payment, allocation, receipt, bill,
ledger and audit changes commit in one transaction. Current grants are checked
again on the server; reference and bill locks guard concurrent/repeated writes.
Partial receipts expire old pending checkout attempts so the next checkout uses
the remaining amount. Fully paid bills also close active/expired links and
suppress unsent reminders. Public receipts identify staff verification without
exposing the staff identity or full transaction reference.

Ledger source distinguishes direct receipts from provider-held money; direct
receipts contribute to gross collections but not provider settlement availability.
This increment does not replace provider verification, support splitting one
bank reference across multiple bills, or add automated refunds/reconciliation.
