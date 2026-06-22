-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "quizId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "isStarted" BOOLEAN NOT NULL,
    "isCompleted" BOOLEAN NOT NULL,

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);
