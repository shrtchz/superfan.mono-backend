/*
  Warnings:

  - Added the required column `quizTime` to the `ongoing_quizzes` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ongoing_quizzes" ADD COLUMN     "quizTime" TEXT NOT NULL;
