/*
  Warnings:

  - Added the required column `assignerFirstName` to the `Task` table without a default value. This is not possible if the table is not empty.
  - Added the required column `assignerLastName` to the `Task` table without a default value. This is not possible if the table is not empty.
  - Added the required column `assignerUserName` to the `Task` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "assignerFirstName" TEXT NOT NULL,
ADD COLUMN     "assignerLastName" TEXT NOT NULL,
ADD COLUMN     "assignerUserName" TEXT NOT NULL;
