-- Additive upgrade for a Phase 1 database. Run before prisma db push.
-- Duplicate membership/period bills deliberately fail the index build for review.
ALTER TABLE "MessageOccurrence" ADD COLUMN IF NOT EXISTS "occurrenceKey" TEXT;
ALTER TABLE "MessageOccurrence" ADD COLUMN IF NOT EXISTS "language" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "MessageOccurrence" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MessageOccurrence" ADD COLUMN IF NOT EXISTS "providerRef" TEXT;
ALTER TABLE "MessageOccurrence" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;
UPDATE "MessageOccurrence" SET "occurrenceKey" = 'legacy:' || "id" WHERE "occurrenceKey" IS NULL;
ALTER TABLE "MessageOccurrence" ALTER COLUMN "occurrenceKey" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "MessageOccurrence_occurrenceKey_key" ON "MessageOccurrence"("occurrenceKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Bill_membershipId_billingPeriod_key" ON "Bill"("membershipId", "billingPeriod");
