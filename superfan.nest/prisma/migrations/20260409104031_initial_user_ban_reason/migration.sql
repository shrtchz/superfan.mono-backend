/*
  Warnings:

  - Added the required column `paymentStatus` to the `Subscription` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "paymentDates" JSONB,
ADD COLUMN     "paymentStatus" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "banReason" TEXT;
