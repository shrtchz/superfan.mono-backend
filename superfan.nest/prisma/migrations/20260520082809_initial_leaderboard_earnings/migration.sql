/*
  Warnings:

  - Added the required column `earning` to the `QuizLeaderboard` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "QuizLeaderboard" ADD COLUMN     "earning" INTEGER NOT NULL;
