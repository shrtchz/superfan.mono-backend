/*
  Warnings:

  - Added the required column `isDeleted` to the `CommentReply` table without a default value. This is not possible if the table is not empty.
  - Added the required column `isDeleted` to the `StreamComment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CommentReply" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL;

-- AlterTable
ALTER TABLE "StreamComment" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL;
