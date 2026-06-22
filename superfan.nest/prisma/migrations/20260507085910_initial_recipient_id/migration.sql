/*
  Warnings:

  - Added the required column `user_id` to the `BushaQuotes` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "BushaQuotes" ADD COLUMN     "user_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "UserWithdrawalWallet" ADD COLUMN     "recipientId" TEXT;
