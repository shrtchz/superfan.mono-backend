/*
  Warnings:

  - The primary key for the `Payout` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `Payout` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `UserHistory` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `UserHistory` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Payout" DROP CONSTRAINT "Payout_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "Payout_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "UserHistory" DROP CONSTRAINT "UserHistory_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "UserHistory_pkey" PRIMARY KEY ("id");
