-- CreateTable
CREATE TABLE "Subscription" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "subscriptionPlan" "SubscriptionPlan" NOT NULL,
    "mandanteReference" TEXT NOT NULL,
    "mandateId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "debitAmount" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");
