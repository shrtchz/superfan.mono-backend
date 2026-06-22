-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityType" ADD VALUE 'CREDIT';
ALTER TYPE "ActivityType" ADD VALUE 'DEBIT';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "amount" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "WalletTransaction" ALTER COLUMN "description" DROP NOT NULL,
ALTER COLUMN "reference" DROP NOT NULL,
ALTER COLUMN "status" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ActivityWallet" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "ActivityType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "reference" TEXT,
    "status" "ActivityStatus" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityWallet_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ActivityWallet" ADD CONSTRAINT "ActivityWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
