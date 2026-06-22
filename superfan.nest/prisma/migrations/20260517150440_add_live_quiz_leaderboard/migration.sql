-- AlterTable
ALTER TABLE "ongoing_live_quiz" ADD COLUMN     "totalEarning" INTEGER;

-- CreateTable
CREATE TABLE "LiveQuizLeaderboard" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "participants" INTEGER NOT NULL DEFAULT 0,
    "unitPrize" INTEGER NOT NULL DEFAULT 0,
    "rewardStatus" TEXT NOT NULL DEFAULT 'pending',
    "quizDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveQuizLeaderboard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveQuizLeaderboard_userId_idx" ON "LiveQuizLeaderboard"("userId");

-- CreateIndex
CREATE INDEX "LiveQuizLeaderboard_quizId_idx" ON "LiveQuizLeaderboard"("quizId");

-- CreateIndex
CREATE INDEX "LiveQuizLeaderboard_quizDate_idx" ON "LiveQuizLeaderboard"("quizDate");
