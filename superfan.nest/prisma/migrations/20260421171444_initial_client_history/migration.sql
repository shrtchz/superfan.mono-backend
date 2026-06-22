-- CreateEnum
CREATE TYPE "HistoryType" AS ENUM ('REPORT', 'FEEDBACK');

-- CreateEnum
CREATE TYPE "SubmittedBy" AS ENUM ('ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('COMPLETED', 'PENDING');

-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('BUSHA', 'FLUTTERWAVE', 'MONNIFY');

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" "PayoutMethod" NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserHistory" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "HistoryType" NOT NULL,
    "description" TEXT NOT NULL,
    "submittedBy" "SubmittedBy" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payout_reference_key" ON "Payout"("reference");

-- CreateIndex
CREATE INDEX "UserHistory_userId_idx" ON "UserHistory"("userId");

-- CreateIndex
CREATE INDEX "UserHistory_createdAt_idx" ON "UserHistory"("createdAt");

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHistory" ADD CONSTRAINT "UserHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
