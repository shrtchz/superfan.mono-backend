/*
  Warnings:

  - Added the required column `userId` to the `bitnobWithdrawal` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "bitnobWithdrawal" ADD COLUMN     "userId" INTEGER NOT NULL;
