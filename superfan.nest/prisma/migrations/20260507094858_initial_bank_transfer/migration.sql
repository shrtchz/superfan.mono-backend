-- CreateEnum
CREATE TYPE "BankTransferStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "BankTransfer" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "transactionReference" TEXT NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalPayable" DECIMAL(18,2) NOT NULL,
    "ussdPayment" TEXT,
    "collectionChannel" TEXT,
    "productInformation" TEXT,
    "status" "BankTransferStatus" NOT NULL DEFAULT 'PENDING',
    "requestTime" TIMESTAMP(3) NOT NULL,
    "expiresOn" TIMESTAMP(3) NOT NULL,
    "accountDurationSeconds" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankTransfer_transactionReference_key" ON "BankTransfer"("transactionReference");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransfer_paymentReference_key" ON "BankTransfer"("paymentReference");

-- CreateIndex
CREATE INDEX "BankTransfer_userId_idx" ON "BankTransfer"("userId");

-- CreateIndex
CREATE INDEX "BankTransfer_transactionReference_idx" ON "BankTransfer"("transactionReference");

-- CreateIndex
CREATE INDEX "BankTransfer_paymentReference_idx" ON "BankTransfer"("paymentReference");

-- CreateIndex
CREATE INDEX "BankTransfer_status_idx" ON "BankTransfer"("status");

-- AddForeignKey
ALTER TABLE "BankTransfer" ADD CONSTRAINT "BankTransfer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
