/*
  Warnings:

  - Added the required column `accuracyBonus` to the `ongoing_quizzes` table without a default value. This is not possible if the table is not empty.
  - Added the required column `adBonuses` to the `ongoing_quizzes` table without a default value. This is not possible if the table is not empty.
  - Added the required column `baseScore` to the `ongoing_quizzes` table without a default value. This is not possible if the table is not empty.
  - Added the required column `speedBonus` to the `ongoing_quizzes` table without a default value. This is not possible if the table is not empty.
  - Added the required column `streakMultiplier` to the `ongoing_quizzes` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ongoing_quizzes" ADD COLUMN     "accuracyBonus" INTEGER NOT NULL,
ADD COLUMN     "adBonuses" INTEGER NOT NULL,
ADD COLUMN     "baseScore" INTEGER NOT NULL,
ADD COLUMN     "speedBonus" INTEGER NOT NULL,
ADD COLUMN     "streakMultiplier" INTEGER NOT NULL;
