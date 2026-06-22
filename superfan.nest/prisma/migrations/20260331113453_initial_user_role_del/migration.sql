-- AlterTable
ALTER TABLE "User" ADD COLUMN     "subAccountCode" TEXT,
ALTER COLUMN "lastName" DROP NOT NULL,
ALTER COLUMN "phone" DROP NOT NULL;
