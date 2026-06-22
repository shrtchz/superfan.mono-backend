/*
  Warnings:

  - A unique constraint covering the columns `[quizId]` on the table `QuizAttempt` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "QuizAttempt_quizId_key" ON "QuizAttempt"("quizId");

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "ongoing_quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
