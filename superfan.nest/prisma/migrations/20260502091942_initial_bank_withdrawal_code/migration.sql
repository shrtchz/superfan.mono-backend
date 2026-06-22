/*
  Warnings:

  - Added the required column `bankCode` to the `UserWithdrawalBank` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "UserWithdrawalBank" ADD COLUMN     "bankCode" TEXT NOT NULL;
