-- CreateTable
CREATE TABLE "QuizLeaderboard" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "testLevel" TEXT NOT NULL,
    "selectedAnswer" TEXT NOT NULL,
    "correctAnswer" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizLeaderboard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuizLeaderboard_userId_idx" ON "QuizLeaderboard"("userId");

-- CreateIndex
CREATE INDEX "QuizLeaderboard_quizId_idx" ON "QuizLeaderboard"("quizId");
