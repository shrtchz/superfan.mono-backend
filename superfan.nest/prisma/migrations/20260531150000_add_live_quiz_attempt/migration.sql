-- CreateTable
CREATE TABLE "live_quiz_attempts" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "ongoingLiveQuizId" INTEGER,
    "totalPrize" INTEGER,
    "recipients" INTEGER,
    "unitPrize" INTEGER,
    "earning" INTEGER NOT NULL DEFAULT 0,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "live_quiz_attempts_userId_quizId_key" ON "live_quiz_attempts"("userId", "quizId");

-- CreateIndex
CREATE INDEX "live_quiz_attempts_quizId_idx" ON "live_quiz_attempts"("quizId");

-- CreateIndex
CREATE INDEX "live_quiz_attempts_userId_idx" ON "live_quiz_attempts"("userId");

-- CreateIndex
CREATE INDEX "live_quiz_attempts_quizId_isCompleted_idx" ON "live_quiz_attempts"("quizId", "isCompleted");

-- AddForeignKey
ALTER TABLE "live_quiz_attempts" ADD CONSTRAINT "live_quiz_attempts_ongoingLiveQuizId_fkey" FOREIGN KEY ("ongoingLiveQuizId") REFERENCES "ongoing_live_quiz"("id") ON DELETE SET NULL ON UPDATE CASCADE;
