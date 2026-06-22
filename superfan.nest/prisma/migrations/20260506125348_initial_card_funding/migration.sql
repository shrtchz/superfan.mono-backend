-- DropForeignKey
ALTER TABLE "SubscriptionDebit" DROP CONSTRAINT "SubscriptionDebit_subscriptionId_fkey";

-- CreateTable
CREATE TABLE "CardFunding" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "walletId" INTEGER,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "flwRef" TEXT,
    "status" TEXT NOT NULL,
    "cardLast4" TEXT,
    "cardToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardFunding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardFunding_reference_key" ON "CardFunding"("reference");

-- AddForeignKey
ALTER TABLE "SubscriptionDebit" ADD CONSTRAINT "SubscriptionDebit_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardFunding" ADD CONSTRAINT "CardFunding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
