/*
  Warnings:

  - You are about to drop the column `assignerFirstName` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `assignerId` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `assignerLastName` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `assignerUserName` on the `Task` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Task" DROP COLUMN "assignerFirstName",
DROP COLUMN "assignerId",
DROP COLUMN "assignerLastName",
DROP COLUMN "assignerUserName";
