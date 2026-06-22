-- AlterTable
ALTER TABLE "User" ADD COLUMN     "address" TEXT,
ADD COLUMN     "bvn" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "dob" TIMESTAMP(3),
ADD COLUMN     "nin" TEXT;
