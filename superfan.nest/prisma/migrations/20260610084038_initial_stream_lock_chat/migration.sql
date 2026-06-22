/*
  Warnings:

  - You are about to alter the column `totalEarninginNaira` on the `ongoing_quizzes` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - You are about to alter the column `totalEarninginUSDC` on the `ongoing_quizzes` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - You are about to alter the column `totalEarninginUSDT` on the `ongoing_quizzes` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - Added the required column `status` to the `Stream` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Stream" ADD COLUMN     "category" TEXT,
ADD COLUMN     "lockChat" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scheduledDate" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL,
ADD COLUMN     "thumbnailUrl" TEXT,
ALTER COLUMN "streamUrl" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ongoing_quizzes" ALTER COLUMN "totalEarninginNaira" SET DATA TYPE INTEGER,
ALTER COLUMN "totalEarninginUSDC" SET DATA TYPE INTEGER,
ALTER COLUMN "totalEarninginUSDT" SET DATA TYPE INTEGER;
