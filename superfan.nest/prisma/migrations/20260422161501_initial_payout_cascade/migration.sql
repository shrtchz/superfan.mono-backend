-- DropForeignKey
ALTER TABLE "Payout" DROP CONSTRAINT "Payout_userId_fkey";

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
