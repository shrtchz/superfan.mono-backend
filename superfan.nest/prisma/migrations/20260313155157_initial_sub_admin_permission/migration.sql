/*
  Warnings:

  - A unique constraint covering the columns `[inviteId,permissionId]` on the table `SubAdminPermission` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `inviteId` to the `SubAdminPermission` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "SubAdminPermission" DROP CONSTRAINT "SubAdminPermission_subAdminId_fkey";

-- DropIndex
DROP INDEX "SubAdminPermission_subAdminId_permissionId_key";

-- AlterTable
ALTER TABLE "SubAdminPermission" ADD COLUMN     "inviteId" INTEGER NOT NULL,
ALTER COLUMN "subAdminId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SubAdminPermission_inviteId_permissionId_key" ON "SubAdminPermission"("inviteId", "permissionId");

-- AddForeignKey
ALTER TABLE "SubAdminPermission" ADD CONSTRAINT "SubAdminPermission_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "SubAdminInvite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubAdminPermission" ADD CONSTRAINT "SubAdminPermission_subAdminId_fkey" FOREIGN KEY ("subAdminId") REFERENCES "SubAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
