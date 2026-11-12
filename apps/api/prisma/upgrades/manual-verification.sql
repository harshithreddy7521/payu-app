-- Additive; preserves all existing provider-backed payments.
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'PROVIDER';
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "recordedBy" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "verificationMethod" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "verificationNote" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'PROVIDER';
