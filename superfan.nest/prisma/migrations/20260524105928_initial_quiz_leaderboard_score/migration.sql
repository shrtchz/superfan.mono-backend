-- AlterTable
ALTER TABLE "QuizLeaderboard" ADD COLUMN     "accuracyBonus" TEXT,
ADD COLUMN     "score" TEXT,
ALTER COLUMN "quizTime" DROP NOT NULL;
