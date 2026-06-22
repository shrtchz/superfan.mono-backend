/*
  Warnings:

  - Added the required column `quizTime` to the `QuizLeaderboard` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "QuizLeaderboard" ADD COLUMN     "quizTime" TEXT NOT NULL;
