-- CreateTable
CREATE TABLE "YouTubeToken" (
    "id" SERIAL NOT NULL,
    "service" TEXT NOT NULL DEFAULT 'youtube',
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiryDate" TIMESTAMP(3),
    "scope" TEXT,
    "tokenType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeToken_service_key" ON "YouTubeToken"("service");
