/*
  Warnings:

  - The values [5] on the enum `QuestionPreference` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "QuestionPreference_new" AS ENUM ('25', '50', '100', '200', '400', '1000');
ALTER TABLE "User" ALTER COLUMN "questionPreference" TYPE "QuestionPreference_new" USING ("questionPreference"::text::"QuestionPreference_new");
ALTER TYPE "QuestionPreference" RENAME TO "QuestionPreference_old";
ALTER TYPE "QuestionPreference_new" RENAME TO "QuestionPreference";
DROP TYPE "public"."QuestionPreference_old";
COMMIT;
