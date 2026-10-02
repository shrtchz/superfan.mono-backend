-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "KycTier" AS ENUM ('TIER_0', 'TIER_1');

-- AlterTable
ALTER TABLE "User" 
ADD COLUMN "kyc_status" "KycStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN "kyc_tier" "KycTier" NOT NULL DEFAULT 'TIER_0',
ADD COLUMN "didit_session_id" TEXT,
ADD COLUMN "didit_verification_id" TEXT,
ADD COLUMN "kyc_rejection_reason" TEXT,
ADD COLUMN "kyc_verified_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_didit_session_id_key" ON "User"("didit_session_id");
