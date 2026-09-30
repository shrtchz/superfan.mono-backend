-- CreateTable
CREATE TABLE "stream_chat_lock_logs" (
    "id" SERIAL NOT NULL,
    "streamId" INTEGER NOT NULL,
    "adminId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stream_chat_lock_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stream_chat_lock_logs_streamId_idx" ON "stream_chat_lock_logs"("streamId");

-- CreateIndex
CREATE INDEX "stream_chat_lock_logs_adminId_idx" ON "stream_chat_lock_logs"("adminId");

-- CreateIndex
CREATE INDEX "stream_chat_lock_logs_createdAt_idx" ON "stream_chat_lock_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "stream_chat_lock_logs" ADD CONSTRAINT "stream_chat_lock_logs_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
