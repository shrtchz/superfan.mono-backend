/*
  Warnings:

  - The values [250] on the enum `QuestionPreference` will be removed. If these variants are still used in the database, this will fail.
  - The values [10,25] on the enum `TimePreference` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "QuestionPreference_new" AS ENUM ('5', '25', '50', '100', '200', '400', '1000');
ALTER TABLE "User" ALTER COLUMN "questionPreference" TYPE "QuestionPreference_new" USING ("questionPreference"::text::"QuestionPreference_new");
ALTER TYPE "QuestionPreference" RENAME TO "QuestionPreference_old";
ALTER TYPE "QuestionPreference_new" RENAME TO "QuestionPreference";
DROP TYPE "public"."QuestionPreference_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "TimePreference_new" AS ENUM ('5', '15', '30', '45', '60', 'unlimited');
ALTER TABLE "User" ALTER COLUMN "timePreference" TYPE "TimePreference_new" USING ("timePreference"::text::"TimePreference_new");
ALTER TYPE "TimePreference" RENAME TO "TimePreference_old";
ALTER TYPE "TimePreference_new" RENAME TO "TimePreference";
DROP TYPE "public"."TimePreference_old";
COMMIT;
