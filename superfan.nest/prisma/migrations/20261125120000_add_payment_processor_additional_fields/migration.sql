-- Arbitrary per-processor config (e.g. Monnify contractCode)
ALTER TABLE "PaymentProcessor" ADD COLUMN "additionalFields" JSONB;
