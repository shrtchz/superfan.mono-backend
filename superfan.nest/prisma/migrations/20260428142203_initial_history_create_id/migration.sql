-- AddForeignKey
ALTER TABLE "UserHistory" ADD CONSTRAINT "UserHistory_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
