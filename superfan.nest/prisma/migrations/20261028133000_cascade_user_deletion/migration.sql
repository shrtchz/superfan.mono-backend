-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- DropForeignKey
ALTER TABLE "SubAdminInvite" DROP CONSTRAINT IF EXISTS "SubAdminInvite_invitedById_fkey";

-- DropForeignKey
ALTER TABLE "SubAdminPermission" DROP CONSTRAINT IF EXISTS "SubAdminPermission_inviteId_fkey";

-- DropForeignKey
ALTER TABLE "UserCard" DROP CONSTRAINT IF EXISTS "UserCard_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserHistory" DROP CONSTRAINT IF EXISTS "UserHistory_creatorId_fkey";

-- AddForeignKey
ALTER TABLE "SubAdminInvite" ADD CONSTRAINT "SubAdminInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubAdminPermission" ADD CONSTRAINT "SubAdminPermission_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "SubAdminInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCard" ADD CONSTRAINT "UserCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHistory" ADD CONSTRAINT "UserHistory_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
