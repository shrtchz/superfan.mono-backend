-- DropForeignKey
ALTER TABLE "CommentReply" DROP CONSTRAINT "CommentReply_commentId_fkey";

-- AddForeignKey
ALTER TABLE "CommentReply" ADD CONSTRAINT "CommentReply_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "StreamComment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
