-- CreateTable
CREATE TABLE "ongoing_quizzes" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "testQuiz" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "testLevel" TEXT NOT NULL,
    "totalEarning" INTEGER NOT NULL,
    "totalQuestions" INTEGER NOT NULL,
    "totalTime" INTEGER NOT NULL,
    "timeRemaining" INTEGER NOT NULL,
    "questions" JSONB NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "currentIndex" INTEGER NOT NULL DEFAULT 0,
    "earnedAmount" INTEGER NOT NULL DEFAULT 0,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ongoing_quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ongoing_quizzes_userId_idx" ON "ongoing_quizzes"("userId");

-- CreateIndex
CREATE INDEX "ongoing_quizzes_userId_isCompleted_idx" ON "ongoing_quizzes"("userId", "isCompleted");

-- AddForeignKey
ALTER TABLE "ongoing_quizzes" ADD CONSTRAINT "ongoing_quizzes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
