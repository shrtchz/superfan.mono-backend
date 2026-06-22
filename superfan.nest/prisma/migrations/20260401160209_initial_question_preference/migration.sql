/*
  Warnings:

  - Added the required column `questionPreference` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "QuestionPreference" AS ENUM ('25', '50', '100', '200', '400', '1000');

-- CreateEnum
CREATE TYPE "TimePreference" AS ENUM ('5', '15', '30', '45', '60', 'unlimited');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "questionPreference" "QuestionPreference" NOT NULL,
ADD COLUMN     "timePreference" "TimePreference";
