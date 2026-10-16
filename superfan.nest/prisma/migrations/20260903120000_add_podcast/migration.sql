CREATE TABLE "Podcast" ("id" SERIAL NOT NULL, "title" TEXT NOT NULL, "description" TEXT, "episode" INTEGER NOT NULL, "host" TEXT NOT NULL, "guest" TEXT, "youtubeVideoId" TEXT NOT NULL, "youtubeUrl" TEXT NOT NULL, "thumbnailUrl" TEXT, "duration" TEXT, "privacyStatus" TEXT NOT NULL DEFAULT 'private', "uploadStatus" TEXT NOT NULL DEFAULT 'PROCESSING', "publishedAt" TIMESTAMP(3), "createdById" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Podcast_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "Podcast_youtubeVideoId_key" ON "Podcast"("youtubeVideoId");
CREATE INDEX "Podcast_publishedAt_idx" ON "Podcast"("publishedAt");
CREATE INDEX "Podcast_createdById_idx" ON "Podcast"("createdById");
ALTER TABLE "Podcast" ADD CONSTRAINT "Podcast_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
