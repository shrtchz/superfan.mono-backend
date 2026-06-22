-- DropForeignKey
ALTER TABLE "SubAdminPermission" DROP CONSTRAINT "SubAdminPermission_inviteId_fkey";

-- AlterTable
ALTER TABLE "SubAdminPermission" ALTER COLUMN "inviteId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "SubAdminPermission" ADD CONSTRAINT "SubAdminPermission_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "SubAdminInvite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
