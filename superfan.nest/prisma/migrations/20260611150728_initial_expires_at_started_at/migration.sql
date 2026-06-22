-- AlterTable
ALTER TABLE "ongoing_quizzes" ALTER COLUMN "startedAt" DROP NOT NULL,
ALTER COLUMN "startedAt" DROP DEFAULT,
ALTER COLUMN "expiresAt" DROP NOT NULL;
