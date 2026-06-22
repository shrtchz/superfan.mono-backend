-- AlterTable
ALTER TABLE "WalletTransaction" ALTER COLUMN "type" DROP NOT NULL,
ALTER COLUMN "account_name" DROP NOT NULL,
ALTER COLUMN "payment_method" DROP NOT NULL,
ALTER COLUMN "username" DROP NOT NULL;
