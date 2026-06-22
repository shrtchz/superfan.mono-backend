-- DropIndex
DROP INDEX "User_userCode_key";

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "userCode" DROP NOT NULL;
