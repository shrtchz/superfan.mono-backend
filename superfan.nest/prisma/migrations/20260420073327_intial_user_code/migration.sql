/*
  Warnings:

  - A unique constraint covering the columns `[userCode]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userCode` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "userCode" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "BushaBalance" (
    "id" SERIAL NOT NULL,
    "balance_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,

    CONSTRAINT "BushaBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BushaBalance_balance_id_key" ON "BushaBalance"("balance_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_userCode_key" ON "User"("userCode");
