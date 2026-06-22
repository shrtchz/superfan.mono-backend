/*
  Warnings:

  - The `status` column on the `Reward` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `currency` to the `Reward` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "EarningStatus" AS ENUM ('PENDING', 'AVAILABLE', 'PAID_OUT');

-- AlterTable
ALTER TABLE "Reward" ADD COLUMN     "currency" TEXT NOT NULL,
ADD COLUMN     "reference" TEXT,
DROP COLUMN "status",
ADD COLUMN     "status" "EarningStatus" NOT NULL DEFAULT 'PENDING';
