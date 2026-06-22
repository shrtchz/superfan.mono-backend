-- DropForeignKey
ALTER TABLE "ActivityWallet" DROP CONSTRAINT "ActivityWallet_userId_fkey";

-- AddForeignKey
ALTER TABLE "ActivityWallet" ADD CONSTRAINT "ActivityWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
