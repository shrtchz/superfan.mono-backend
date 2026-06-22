-- CreateTable
CREATE TABLE "ongoing_live_quiz" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "quizIds" TEXT[],
    "questions" JSONB,
    "answers" JSONB,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ongoing_live_quiz_pkey" PRIMARY KEY ("id")
);
