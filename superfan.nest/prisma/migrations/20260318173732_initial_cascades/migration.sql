-- DropForeignKey
ALTER TABLE "Admin" DROP CONSTRAINT "Admin_roleId_fkey";

-- DropForeignKey
ALTER TABLE "Admin" DROP CONSTRAINT "Admin_userId_fkey";

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_permissionId_fkey";

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_roleId_fkey";

-- DropForeignKey
ALTER TABLE "SubAdmin" DROP CONSTRAINT "SubAdmin_roleId_fkey";

-- DropForeignKey
ALTER TABLE "SubAdmin" DROP CONSTRAINT "SubAdmin_userId_fkey";

-- DropForeignKey
ALTER TABLE "SubAdminPermission" DROP CONSTRAINT "SubAdminPermission_inviteId_fkey";

-- DropForeignKey
ALTER TABLE "SubAdminPermission" DROP CONSTRAINT "SubAdminPermission_permissionId_fkey";

-- DropForeignKey
ALTER TABLE "SubAdminPermission" DROP CONSTRAINT "SubAdminPermission_subAdminId_fkey";

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubAdmin" ADD CONSTRAINT "SubAdmin_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubAdmin" ADD CONSTRAINT "SubAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubAdminPermission" ADD CONSTRAINT "SubAdminPermission_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "SubAdminInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubAdminPermission" ADD CONSTRAINT "SubAdminPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubAdminPermission" ADD CONSTRAINT "SubAdminPermission_subAdminId_fkey" FOREIGN KEY ("subAdminId") REFERENCES "SubAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
