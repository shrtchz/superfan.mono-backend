/*
  Warnings:

  - You are about to drop the column `card_token` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "card_token";

-- CreateTable
CREATE TABLE "UserCard" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "cardToken" TEXT NOT NULL,
    "cardNumber" TEXT,
    "maskedPan" TEXT,
    "cardType" TEXT,
    "expiry" TEXT,
    "issuer" TEXT,
    "country" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserCard_userId_idx" ON "UserCard"("userId");

-- AddForeignKey
ALTER TABLE "UserCard" ADD CONSTRAINT "UserCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
