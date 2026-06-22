/*
  Warnings:

  - The values [USER_REGISTERED,CONTENT_APPROVED,REPORT_SUBMITTED,SUBADMIN_REGISTERED,CREDIT,DEBIT] on the enum `ActivityType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ActivityType_new" AS ENUM ('user_registered', 'content_approved', 'report_submitted', 'subadmin_registered', 'credit', 'debit');
ALTER TABLE "ActivityMonitor" ALTER COLUMN "type" TYPE "ActivityType_new" USING ("type"::text::"ActivityType_new");
ALTER TABLE "ActivityWallet" ALTER COLUMN "type" TYPE "ActivityType_new" USING ("type"::text::"ActivityType_new");
ALTER TYPE "ActivityType" RENAME TO "ActivityType_old";
ALTER TYPE "ActivityType_new" RENAME TO "ActivityType";
DROP TYPE "public"."ActivityType_old";
COMMIT;
