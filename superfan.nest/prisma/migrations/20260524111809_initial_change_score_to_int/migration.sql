/*
  Warnings:

  - The `score` column on the `QuizLeaderboard` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "QuizLeaderboard" DROP COLUMN "score",
ADD COLUMN     "score" INTEGER;
