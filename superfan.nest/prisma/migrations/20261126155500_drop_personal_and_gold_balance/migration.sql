-- Drop redundant mirror wallet balance columns, leaving checkingBalance and savingsBalance
ALTER TABLE "Wallet" DROP COLUMN IF EXISTS "personalBalance";
ALTER TABLE "Wallet" DROP COLUMN IF EXISTS "goldBalance";
