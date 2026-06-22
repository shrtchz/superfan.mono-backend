-- CreateTable
CREATE TABLE "PaymentProcessor" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "publicKey" TEXT,
    "secretKey" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "lastSync" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProcessor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProcessor_name_key" ON "PaymentProcessor"("name");
