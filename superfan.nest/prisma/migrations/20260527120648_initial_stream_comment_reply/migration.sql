-- AddForeignKey
ALTER TABLE "StreamComment" ADD CONSTRAINT "StreamComment_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
