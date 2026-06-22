-- CreateTable
CREATE TABLE "SubAdminPermission" (
    "id" SERIAL NOT NULL,
    "subAdminId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,

    CONSTRAINT "SubAdminPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubAdminPermission_subAdminId_permissionId_key" ON "SubAdminPermission"("subAdminId", "permissionId");

-- AddForeignKey
ALTER TABLE "SubAdminPermission" ADD CONSTRAINT "SubAdminPermission_subAdminId_fkey" FOREIGN KEY ("subAdminId") REFERENCES "SubAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubAdminPermission" ADD CONSTRAINT "SubAdminPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
