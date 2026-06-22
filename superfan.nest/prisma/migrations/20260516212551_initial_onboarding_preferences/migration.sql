/*
  Warnings:

  - The `languagePreference` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `subjectPreference` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "languagePreference",
ADD COLUMN     "languagePreference" TEXT,
DROP COLUMN "subjectPreference",
ADD COLUMN     "subjectPreference" TEXT;

-- DropEnum
DROP TYPE "Language";

-- DropEnum
DROP TYPE "Subject";
