-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'PREMIUM_PRO', 'PREMIUM_PRO_MAX');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('yoruba', 'igbo', 'hausa');

-- CreateEnum
CREATE TYPE "Subject" AS ENUM ('general', 'proverbs', 'folktale', 'sports', 'politics', 'drama');

-- CreateEnum
CREATE TYPE "TestLevel" AS ENUM ('basic', 'intermediate', 'advanced');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "languagePreference" "Language",
ADD COLUMN     "subjectPreference" "Subject",
ADD COLUMN     "subscriptionPlan" "SubscriptionPlan",
ADD COLUMN     "testLevel" "TestLevel";
