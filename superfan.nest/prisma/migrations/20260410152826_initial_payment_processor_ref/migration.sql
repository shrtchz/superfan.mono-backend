/*
  Warnings:

  - Added the required column `account_name` to the `WalletTransaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `payment_date` to the `WalletTransaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `payment_method` to the `WalletTransaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `username` to the `WalletTransaction` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "WalletTransaction" ADD COLUMN     "account_name" TEXT NOT NULL,
ADD COLUMN     "account_no" TEXT,
ADD COLUMN     "bank_name" TEXT,
ADD COLUMN     "cardToken" TEXT,
ADD COLUMN     "last_payout" TIMESTAMP(3),
ADD COLUMN     "payment_date" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "payment_method" TEXT NOT NULL,
ADD COLUMN     "payouts" DOUBLE PRECISION,
ADD COLUMN     "pending_balance" DOUBLE PRECISION,
ADD COLUMN     "settlement_date" TIMESTAMP(3),
ADD COLUMN     "total_earnings" DOUBLE PRECISION,
ADD COLUMN     "username" TEXT NOT NULL,
ADD COLUMN     "wallet_address" TEXT;
