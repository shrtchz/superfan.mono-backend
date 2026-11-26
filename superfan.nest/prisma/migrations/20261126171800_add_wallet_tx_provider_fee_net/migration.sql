-- Ensure WalletTransaction has provider, fee, and net_amount columns
ALTER TABLE "WalletTransaction" ADD COLUMN IF NOT EXISTS "provider" VARCHAR(64);
ALTER TABLE "WalletTransaction" ADD COLUMN IF NOT EXISTS "fee" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "WalletTransaction" ADD COLUMN IF NOT EXISTS "net_amount" DOUBLE PRECISION;
