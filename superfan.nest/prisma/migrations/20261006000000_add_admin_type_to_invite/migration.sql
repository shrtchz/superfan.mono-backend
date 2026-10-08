-- AddColumn: adminType to SubAdminInvite
ALTER TABLE "SubAdminInvite" ADD COLUMN "adminType" TEXT NOT NULL DEFAULT 'subadmin';
