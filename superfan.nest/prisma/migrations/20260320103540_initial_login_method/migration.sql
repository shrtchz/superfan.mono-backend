-- AlterTable
ALTER TABLE "User" ADD COLUMN     "login_method" TEXT;

-- AddForeignKey
ALTER TABLE "SubAdminInvite" ADD CONSTRAINT "SubAdminInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
