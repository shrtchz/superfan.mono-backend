-- DropForeignKey
ALTER TABLE "SubAdminPermission" DROP CONSTRAINT "SubAdminPermission_inviteId_fkey";

-- DropIndex
DROP INDEX "SubAdminPermission_subAdminId_permissionId_key";

-- AddForeignKey
ALTER TABLE "SubAdminPermission" ADD CONSTRAINT "SubAdminPermission_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "SubAdminInvite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
