# Feeflow — India Fee Collection App

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

## Temporary direct UPI collection

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
