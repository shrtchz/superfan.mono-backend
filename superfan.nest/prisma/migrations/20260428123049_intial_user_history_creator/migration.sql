/*
  Warnings:

  - Added the required column `creatorId` to the `UserHistory` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "UserHistory" ADD COLUMN     "creatorId" INTEGER NOT NULL;
