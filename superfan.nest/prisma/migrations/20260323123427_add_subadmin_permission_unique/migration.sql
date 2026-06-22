/*
  Warnings:

  - A unique constraint covering the columns `[subAdminId,permissionId]` on the table `SubAdminPermission` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "SubAdminPermission_subAdminId_permissionId_key" ON "SubAdminPermission"("subAdminId", "permissionId");
