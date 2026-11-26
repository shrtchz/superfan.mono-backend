-- Drop legacy mirror-sync trigger and function before dropping columns
DROP TRIGGER IF EXISTS trg_sync_wallet_balances ON "Wallet";
DROP FUNCTION IF EXISTS public.sync_wallet_balances();

-- Drop redundant mirror wallet balance columns, leaving checkingBalance and savingsBalance
ALTER TABLE "Wallet" DROP COLUMN IF EXISTS "personalBalance";
ALTER TABLE "Wallet" DROP COLUMN IF EXISTS "goldBalance";
