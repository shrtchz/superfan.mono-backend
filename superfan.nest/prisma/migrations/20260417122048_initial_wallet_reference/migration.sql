/*
  Warnings:

  - Added the required column `reference` to the `WalletTransaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `status` to the `WalletTransaction` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "WalletTransaction" ADD COLUMN     "reference" TEXT NOT NULL,
ADD COLUMN     "status" TEXT NOT NULL;
