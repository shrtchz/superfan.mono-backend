/*
  Warnings:

  - You are about to drop the column `masked_card_pan` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "masked_card_pan";
