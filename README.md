# Feeflow — India Fee Collection App

For Android APK creation and private signing on macOS, see the
[Android APK build README](README-ANDROID-APK.md).

Multi-tenant fee collection platform for schools, sports academies and restaurants.
UPI checkout via WhatsApp/SMS links and counter QR. Built to the requirements spec v1.0.

## Quick start

### 0. Install dependencies and configure local environment

Use Node.js 22 or newer and npm, then run from the repository root:

```sh
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

The example settings connect to the local PostgreSQL container and use direct
UPI payment links with a fake messaging provider. Keep these settings for local development only.

### 1. Start PostgreSQL

Docker Desktop must be running, then:

```
docker compose up -d
```

### 2. Push schema & seed demo data

```
cd apps/api
npm run db:push
npm run db:seed
```

### 3. Run API + Web + Worker

Three terminals:

```
# Terminal 1 — API (port 3001)
cd apps/api && npm run dev

# Terminal 2 — Web (port 3000)
cd apps/web && npm run dev

# Terminal 3 — Recurring billing and reminder worker
cd apps/api && npm run worker
```

Open http://localhost:3000

API docs: http://localhost:3001/docs

### Demo logins

| Login                     | Password  | Profile    |
| ------------------------- | --------- | ---------- |
| school.owner@demo.com     | Demo1234! | School     |
| sports.owner@demo.com     | Demo1234! | Sports     |
| restaurant.owner@demo.com | Demo1234! | Restaurant |

## Architecture

```
india-fee-app/
├── apps/
│   ├── api/          Fastify + TypeScript + Prisma (port 3001)
│   ├── web/          Next.js 15 — staff UI + payer checkout (port 3000)
│   └── mobile/       Expo React Native (Android + iOS)
└── packages/
    └── shared/       Enums, types, errors (shared across all apps)
```

### Key flows

**Quick Pay** — POST /v1/quick-pay → returns bill + payment link token
**Checkout** — GET /pay/:token (payer) → POST /pay/:token/checkout → polls /pay/:token/attempt/:id
**Webhooks** — POST /v1/webhooks/fake → idempotent event processing → allocation
**Recurring billing** — separate `npm run worker` process, monthly cycles and durable reminder queue
**Settlement** — GET /v1/settlements (daily settlement worker remains Phase 3 work)

### Provider adapters

`PAYMENT_PROVIDER=fake` runs a local fake that auto-confirms payments after 3 s.
`MESSAGING_PROVIDER=fake` logs messages to console.
Swap in Razorpay/Cashfree/Juspay + WhatsApp Business API + DLT-registered SMS before launch.

## Build order

| Phase                                                 | Status          |
| ----------------------------------------------------- | --------------- |
| 1 — Scaffold, auth, roles, Quick Pay, fake providers | ✅ This release |
| 2 — Members, groups, recurring billing, reminders    | Core local workflows implemented; remaining scope below |
| 3 — Verified destinations, refunds, daily settlement | Planned         |
| 4 — Sandbox providers, device matrix, go-live        | Planned         |

## Existing Phase 1 database upgrade

Back up your database first. The additive upgrade backfills legacy reminder keys
and adds uniqueness constraints without deleting rows. It deliberately fails if
existing membership/period bills are duplicated; resolve those records first.

```sh
cd apps/api
npx prisma db execute --file prisma/upgrades/phase2.sql --schema prisma/schema.prisma
npm run db:push
```

Fresh databases only need the quick-start `db:push` command.

## Try the new workflows

- **Members:** create a member or import a CSV with headers
  `name,externalRef,guardianName,phone`. Preview all row errors before confirming.
- **Groups & billing:** create a monthly group, preview three cycles, add members
  and optionally override their monthly amount. Edit reminders or pause billing
  from the group detail screen. New enrollments start at the next eligible cycle.
- **Reminders:** inspect queue state and delivery outcomes. Keep the worker
  running; the owner’s “Check eligible billing” action catches up the current
  eligible cycle. It never creates bills before their issue date.
- **Transactions:** export the visible rows. Payers can print confirmed receipts.

Fake adapters stay enabled for the demo. Real settlement, verification,
production messaging and provider integrations are still later-stage work.
See [implementation progress](docs/implementation-progress.md) for delivered
features, tests and the remaining specification requirements.

## Mobile (Expo)

```
cd apps/mobile
npm run dev        # starts Expo dev server
npm run android    # requires Android emulator
npm run ios        # requires macOS + Xcode
```

## Workspace signup and Google Drive storage

Open [signup on port 3000](http://localhost:3000/signup), or choose
**Create a workspace** on Android. Complete the workspace and administrator
details, then choose **Google Drive** under **Storage**. A browser profile stores
one Feeflow workspace. Use another profile to create or restore a separate workspace.

### Create the Google service account and spreadsheet

1. In the [Google Cloud Console](https://console.cloud.google.com/), select or
   create a project. Open **APIs & Services → Library** and enable **Google Drive
   API** and **Google Sheets API** in that project. [Enable Google Workspace APIs](https://developers.google.com/workspace/guides/enable-apis)
2. In the same project, open **IAM & Admin → Service Accounts → Create service
   account**. Give it a name such as `feeflow-storage`. Skip the optional project
   roles and copy the account email ending in `.iam.gserviceaccount.com`.
   [Create a Google service account](https://docs.cloud.google.com/iam/docs/service-accounts-create)
3. Open the service account and select **Keys → Add key → Create new key →
   JSON → Create**. Google downloads a JSON file containing the private key.
   Store the file securely and keep it out of the repository. If an organization
   policy blocks key creation, ask your Google Cloud administrator whether an
   exception is permitted for this project. [Create a JSON key](https://docs.cloud.google.com/iam/docs/keys-create-delete)
4. Create a blank Google Sheets spreadsheet in Drive. The spreadsheet file name
   can be anything. Name the worksheet tab exactly `Feeflow`. From **Share**,
   add the service account email as an **Editor** and keep **General access**
   set to **Restricted**. [Share a file with a service account](https://developers.google.com/workspace/guides/create-credentials)

### Fill in the signup form and verify the backup

| Signup field | Value |
| --- | --- |
| Google spreadsheet ID | Copy the part between `/d/` and `/edit` in the spreadsheet URL. |
| Google service-account JSON key | Paste the entire contents of the downloaded JSON file. |
| Cloud backup passphrase | Choose a passphrase of at least 12 characters. Keep it separately from the administrator password and JSON key. |
| Existing cloud workspace ID | Leave blank for a new workspace. Enter the ID from **Settings** only when restoring an existing workspace. |

Create the account, sign in as the owner, then open **Settings → Sync Google Drive
now**. Confirm the app reports **Synced to Google Drive** or **Google Drive is up
to date**. Save the **Cloud workspace ID** displayed in Settings. The sheet
contains encrypted snapshots. Use Feeflow to view or edit records.

The web console exchanges the service-account key for a short-lived Google
access token. Feeflow encrypts the stored key locally with the administrator
password. Sync runs on owner sign-in and hourly while the workspace is open.
To restore on a fresh Android installation or browser profile, choose **Google
Drive** during signup and provide the workspace ID, the original administrator
credentials, the same Google credentials, and the backup passphrase. If two
devices edit offline before syncing, the app preserves both versions and reports
a conflict.

For Android, set `EXPO_PUBLIC_WEB_URL` to the deployed web console’s HTTPS origin
before building the APK. A local-only APK can leave it empty. For hosted web
checkout, set `WEB_URL` and `NEXT_PUBLIC_API_URL` to the public HTTPS addresses
of the console and API.

## WhatsApp, reminders and billing jobs

The existing web console serves both hosted accounts and new device or Google
Drive accounts. It includes the dashboard, member and guardian management, CSV
import, groups, fee overrides, recurring billing, reminders, and transactions
with receipt recording and CSV export. Android also offers WhatsApp drafts,
guardian consent, reminder policies and a manual billing job.

For device or Google Drive accounts, billing catches up when you open the
workspace. Both clients also check hourly while the workspace is open. To run the job
manually, open **Reminders → Check eligible billing**. Ready WhatsApp drafts
respect guardian permission, IST sending hours and the daily cap. A staff member
opens the draft and sends it from WhatsApp. Deploy the web console over HTTPS and
configure the Android public web URL to share a browser-friendly direct UPI
checkout in the message.

Existing hosted accounts retain their database-backed worker, provider queues
and finance review. Provider dispatch remains controlled by
`NOTIFICATIONS_ENABLED` and currently uses the fake provider. Hosted Quick Pay
also offers a manual WhatsApp draft for actual sending.

## Existing hosted workspace and direct UPI collection

`PAYMENT_PROVIDER=manual-upi` is now the default and uses `7090832433@ybl`.
Change `UPI_PAYEE_VPA` in `apps/api/.env` when the company VPA is ready.
`UPI_PAYEE_NAME` is a display hint; payers should confirm the bank-resolved name
in their UPI app. Generated QR codes and `upi://pay` links include the exact INR
amount and note. These can transfer real money.

Direct UPI has no bank confirmation feed: attempts stay pending, demo webhooks
are disabled, and no confirmed receipt, refund or settlement is fabricated.
Automatic verification requires a real payment-provider integration. Set
`PAYMENT_PROVIDER=fake` explicitly only for simulated auto-confirming payments.

A `localhost:3000/pay/...` web link is only reachable on the machine hosting the
app. To share web checkout with another phone, run the web/API on reachable
HTTPS addresses and set `WEB_URL` and `NEXT_PUBLIC_API_URL` accordingly. The QR
and Open UPI app action directly encode the UPI payment, independently of that
web host.

## Record a manually verified UPI payment

For the temporary direct UPI setup, an **Owner** or **Finance** user can choose
**Record verified payment** on a newly created Quick Pay request, or against an
outstanding bill in **Transactions**. Check the receiving UPI app or bank
statement, enter the amount received, UPI/bank reference and received time (IST),
then confirm that the credit was independently checked. Screenshots supplied by
payers are not accepted as verification evidence in this flow.

The server records the verifier, verification method and note, creates an
attributed payment/receipt and ledger entry, and updates the bill to Partial or
Paid. It rejects duplicate references with different details, excessive amounts,
future receipt times and unauthorised users. Retrying the same record returns
the original receipt. A fully paid bill suppresses queued reminders. A payer can
use **Check recorded payment status** on the checkout page to see the result.
Manual payments are labelled **Staff verified** and excluded from provider
settlement availability; this is staff reconciliation, not automatic bank
verification. It does not move money or initiate a payout.

Existing databases can apply the additive upgrade before starting the API:

```sh
cd apps/api
npx prisma db execute --file prisma/upgrades/manual-verification.sql --schema prisma/schema.prisma
npm run db:push
```

Fresh databases only need `npm run db:push`. Regression tests including concurrent
allocations can be run with `cd apps/api && RUN_DB_TESTS=1 npm test` against a
local development database; test fixtures are cleaned up afterwards.

## Audit-gap hardening and WhatsApp preparation

Quick Pay now uses persisted, organisation-scoped `Idempotency-Key` results and
creates distinct bills for distinct requests even when amount/purpose match.
Membership enrollment accepts the same retry header. Changed payloads under a
reused key conflict. Web/mobile clients retain keys across transport retries.
Quick Pay validates member ownership and atomically queues delivery separately
from bill creation. A delivery failure cannot recreate the bill.

Authenticated routes refresh active role/branch grants. Group removal enforces
branch access. Refund request replay is tenant-checked and allocations are
serialized to prevent concurrent over-refunds. Refund execution is still not
implemented; these are requests only.

Billing recovers eligible historical months, using versioned group rules after
edits, with membership/period uniqueness. Historical reminders older than today
are not burst-sent. Versions are prospective from this upgrade: past rule edits
made before version tracking cannot be reconstructed. Archived members remain
excluded from automatic billing; historical corrections need explicit review.

Record guardian WhatsApp permission in **Members** before reminders are eligible.
Existing guardians have no consent evidence and will be suppressed until an owner
records it. Withdrawal is audited and cancels queued reminders. Owners can edit
sending hours (IST) and recipient caps in **Settings**. Quick Pay WhatsApp sends
also require an explicit permission checkbox. SMS integration is deferred.

After pulling this schema update, stop API/worker, run `cd apps/api && npm run
db:push`, and restart both. `predev`/`preworker` regenerate Prisma automatically;
these scripts do not silently apply database changes. Back up deployed databases
before upgrades. See [Meta setup guide](docs/whatsapp-meta-setup.md) to create a
WhatsApp test account. Keep `MESSAGING_PROVIDER=fake` until the real adapter is
implemented and tested.

## Android/iOS staff app and finance review

`apps/mobile` now has a runnable Expo application instead of an isolated screen.
It includes sign-in, secure sessions, Quick Pay/QR/share, dashboard, members,
groups, transactions, manual verification and finance-review screens. See
[mobile setup and release gates](docs/mobile-release.md) for configuration,
bundling checks, EAS build profiles, signing requirements and remaining work.

Notifications are paused unless `NOTIFICATIONS_ENABLED=true` is explicitly set.
The billing worker continues issuing bills. Keep sending disabled during Meta
review; no silent SMS fallback or real provider connection is added here.

Owners can request **bank destination review**, and a different authorised actor
can approve the review. Only masked details are stored, and review approval
cannot activate a payout destination. Finance users can independently approve
refund reviews; requests remain REQUESTED until a future provider submits them.
Web finance review is at `/app/finance`. These flows do not move money.

After pulling, run `cd apps/api && npm run db:push` and restart API/worker. For
production, the API refuses startup with the example JWT secret; configure a
unique secret of at least 32 characters and `CORS_ORIGINS` explicitly.

## Single-device Android edition

The mobile entry point now uses local SQLCipher SQLite storage, admin setup and
admin-only encrypted backup/restore. No API configuration is needed for this
edition. See [offline Android setup](docs/android-offline.md). Existing server
data is preserved but not automatically copied to a phone. Notifications and
cloud-dependent finance actions are unavailable in the local edition.

## Workspace profiles, roles and password recovery

Choose School, Sports complex, or Restaurant at signup. After setup, the app
uses the workspace’s name. The owner can create administrator and staff
accounts. Administrators manage groups, tuition settings and concessions.
Staff can enter members and prepare eligible WhatsApp reminders. Only the owner
can manage access, backups and verified payment recording.

Schools can set standard tuition per billing cycle in Settings and record
optional hostel fees per student. School and sports concessions are whole
percentages from 0 to 100. Concessions reduce tuition or sports fees while
hostel charges remain separate. Monthly, quarterly and yearly groups issue
bills and schedule WhatsApp reminders for each cycle. A reminder uses the
outstanding balance after the concession and recorded payments.

For email recovery, configure an HTTPS `FEEFLOW_PUBLIC_URL`, verified
`FEEFLOW_RESET_FROM`, `RESEND_API_KEY` and a unique `FEEFLOW_RESET_SECRET` in the
web deployment. Android also needs `EXPO_PUBLIC_WEB_URL`. Request the link on the
device where the account is stored. In the browser, open it in the browser that
requested the reset. On Android, paste it into the app’s reset form. Cloud owners
also enter their Google Drive backup passphrase. Owners of older Google Drive
workspaces need one successful sign-in to enable recovery. Existing server-hosted
accounts use their existing authentication flow.

## Class plans, sports memberships and restaurant Quick Pay

For a device or Google Drive school workspace, create a class with an academic
start month, annual tuition, optional hostel fees and named charges. Mark charges
as required or optional. Books, admission, registration, kits and uniforms are
due at enrollment. At enrollment select the class, optional charges and monthly,
quarterly or full payment. New class plans use the class fees rather than the
legacy individual tuition field. A student can have one planned class per
academic year. A late enrollment uses the class's annual schedule, so any
scheduled installments already due are included in the first balance.

Concessions apply to tuition or the sports program fee. A monthly reminder shows
the balance after verified payments, including unpaid upfront charges and prior
installments. Quarterly installments only add a charge each quarter. Full payment
makes the fee due in one installment. Advance payments reduce future balances.
Open Reminders to review and send the prepared drafts through WhatsApp.

Sports complexes can create a renewable program or a fixed-term coaching program.
Renewals open seven days before expiry. Access is marked paused once the paid
period ends, and additional renewal charges wait until the open one is paid.
Fixed-term plans retain unpaid installments. Renewable membership fees are per
term, and registration or kit charges apply to the initial period.

Restaurants start in Quick Pay with an optional table or order reference.
Transactions and settings remain available, and owners can view today's
collections in IST. Existing groups keep their original billing rules.
