-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'SUBADMIN_REGISTERED';

-- DropIndex
DROP INDEX "Subscription_userId_key";
