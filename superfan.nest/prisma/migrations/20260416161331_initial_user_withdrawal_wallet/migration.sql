/*
  Warnings:

  - The `card_token` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "card_token",
ADD COLUMN     "card_token" JSONB;

-- CreateTable
CREATE TABLE "UserWithdrawalWallet" (
    "id" SERIAL NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWithdrawalWallet_pkey" PRIMARY KEY ("id")
);
