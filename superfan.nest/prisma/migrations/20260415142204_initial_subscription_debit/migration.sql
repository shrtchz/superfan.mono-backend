-- CreateTable
CREATE TABLE "SubscriptionDebit" (
    "id" SERIAL NOT NULL,
    "subscriptionId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "debitDate" TIMESTAMP(3) NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "transactionRef" TEXT,
    "status" TEXT NOT NULL,
    "narration" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionDebit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionDebit_paymentReference_key" ON "SubscriptionDebit"("paymentReference");

-- AddForeignKey
ALTER TABLE "SubscriptionDebit" ADD CONSTRAINT "SubscriptionDebit_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
