-- CreateTable
CREATE TABLE "StreamUserBan" (
    "id" SERIAL NOT NULL,
    "streamId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "banReason" TEXT,
    "bannedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamUserBan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StreamUserBan_streamId_idx" ON "StreamUserBan"("streamId");

-- CreateIndex
CREATE INDEX "StreamUserBan_userId_idx" ON "StreamUserBan"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StreamUserBan_streamId_userId_key" ON "StreamUserBan"("streamId", "userId");

-- AddForeignKey
ALTER TABLE "StreamUserBan" ADD CONSTRAINT "StreamUserBan_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
