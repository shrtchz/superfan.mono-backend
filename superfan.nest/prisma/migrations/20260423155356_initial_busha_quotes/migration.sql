-- CreateTable
CREATE TABLE "BushaQuotes" (
    "id" SERIAL NOT NULL,
    "quote_id" TEXT NOT NULL,
    "source_currency" TEXT NOT NULL,
    "target_currency" TEXT NOT NULL,
    "source_amount" TEXT NOT NULL,
    "target_amount" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BushaQuotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BushaQuotes_quote_id_key" ON "BushaQuotes"("quote_id");
