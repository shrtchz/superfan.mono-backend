/*
  Warnings:

  - You are about to drop the column `hashedRt` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Point" ADD COLUMN     "accountType" TEXT NOT NULL DEFAULT 'Gold';

-- AlterTable
ALTER TABLE "User" DROP COLUMN "hashedRt";
