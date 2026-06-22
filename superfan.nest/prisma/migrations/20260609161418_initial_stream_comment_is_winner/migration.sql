-- AlterTable
ALTER TABLE "StreamComment" ADD COLUMN     "isPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isWinner" BOOLEAN NOT NULL DEFAULT false;
