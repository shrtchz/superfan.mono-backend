-- CreateTable
CREATE TABLE "bitnobWithdrawal" (
    "id" SERIAL NOT NULL,
    "transactionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "memo" TEXT,
    "description" TEXT,
    "hash" TEXT,
    "fee" TEXT,
    "success_timestamp" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bitnobWithdrawal_pkey" PRIMARY KEY ("id")
);
