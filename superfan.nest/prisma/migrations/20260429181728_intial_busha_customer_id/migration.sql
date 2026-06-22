/*
  Warnings:

  - Added the required column `customer_id` to the `BushaQuotes` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "BushaQuotes" ADD COLUMN     "customer_id" TEXT NOT NULL;
