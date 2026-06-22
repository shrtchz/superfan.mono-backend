-- CreateTable
CREATE TABLE "UserWithdrawalBank" (
    "id" SERIAL NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWithdrawalBank_pkey" PRIMARY KEY ("id")
);
