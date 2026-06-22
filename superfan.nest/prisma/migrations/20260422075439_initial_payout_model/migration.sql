/*
  Warnings:

  - Added the required column `currency` to the `Payout` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "currency" TEXT NOT NULL,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerRef" TEXT;
