/*
  Warnings:

  - You are about to drop the column `module` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `moduleId` on the `Task` table. All the data in the column will be lost.
  - Added the required column `assignTo` to the `Task` table without a default value. This is not possible if the table is not empty.
  - Added the required column `assignmentDate` to the `Task` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `Task` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Task" DROP COLUMN "module",
DROP COLUMN "moduleId",
ADD COLUMN     "assignTo" TEXT NOT NULL,
ADD COLUMN     "assignmentDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "userId" INTEGER NOT NULL;
