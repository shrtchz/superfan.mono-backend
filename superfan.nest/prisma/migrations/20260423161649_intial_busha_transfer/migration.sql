-- CreateTable
CREATE TABLE "BushaTransfer" (
    "id" SERIAL NOT NULL,
    "trf_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "pay_in" JSONB,
    "fees" JSONB,
    "quote_id" TEXT,
    "profile_id" TEXT,
    "source_currency" TEXT,
    "target_currency" TEXT,
    "source_amount" TEXT,
    "target_amount" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BushaTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BushaTransfer_trf_id_key" ON "BushaTransfer"("trf_id");
