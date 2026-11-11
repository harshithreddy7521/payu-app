# India Fee Collection App — Phase 1

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

The example settings connect to the local PostgreSQL container and use fake
payment and messaging providers. Keep these settings for local development only.

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

### 3. Run API + Web

Two terminals:

```
# Terminal 1 — API (port 3001)
cd apps/api && npm run dev

# Terminal 2 — Web (port 3000)
cd apps/web && npm run dev
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
**Settlement** — GET /v1/settlements (Phase 4: daily worker at 02:00 IST)

### Provider adapters

`PAYMENT_PROVIDER=fake` runs a local fake that auto-confirms payments after 3 s.
`MESSAGING_PROVIDER=fake` logs messages to console.
Swap in Razorpay/Cashfree/Juspay + WhatsApp Business API + DLT-registered SMS before launch.

## Build order

| Phase                                                 | Status          |
| ----------------------------------------------------- | --------------- |
| 1 — Scaffold, auth, roles, Quick Pay, fake providers | ✅ This release |
| 2 — Members, groups, recurring billing, reminders    | Planned         |
| 3 — Verified destinations, refunds, daily settlement | Planned         |
| 4 — Sandbox providers, device matrix, go-live        | Planned         |

## Mobile (Expo)

```
cd apps/mobile
npm run dev        # starts Expo dev server
npm run android    # requires Android emulator
npm run ios        # requires macOS + Xcode
```
