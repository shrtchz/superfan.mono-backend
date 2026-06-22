/*
  Warnings:

  - Added the required column `title` to the `UserHistory` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "cardToken" TEXT,
ALTER COLUMN "mandateReference" DROP NOT NULL,
ALTER COLUMN "mandateCode" DROP NOT NULL;

-- AlterTable
ALTER TABLE "UserHistory" ADD COLUMN     "title" TEXT NOT NULL;
