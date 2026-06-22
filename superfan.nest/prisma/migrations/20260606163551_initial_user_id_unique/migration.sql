/*
  Warnings:

  - A unique constraint covering the columns `[userId]` on the table `ongoing_quizzes` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "ongoing_quizzes_userId_key" ON "ongoing_quizzes"("userId");
