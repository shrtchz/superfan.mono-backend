-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('USER_REGISTERED', 'CONTENT_APPROVED', 'REPORT_SUBMITTED');

-- CreateTable
CREATE TABLE "ActivityMonitor" (
    "id" SERIAL NOT NULL,
    "type" "ActivityType" NOT NULL,
    "actorId" INTEGER,
    "actorName" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityMonitor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityMonitor_createdAt_idx" ON "ActivityMonitor"("createdAt");
