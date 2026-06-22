-- CreateTable
CREATE TABLE "Stream" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "privacyStatus" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "rtmpUrl" TEXT NOT NULL,
    "streamKey" TEXT NOT NULL,
    "streamUrl" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stream_pkey" PRIMARY KEY ("id")
);
