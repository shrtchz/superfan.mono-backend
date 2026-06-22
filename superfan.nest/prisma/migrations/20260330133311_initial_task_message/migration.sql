-- CreateTable
CREATE TABLE "TaskMessage" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "senderId" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskMessage_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TaskMessage" ADD CONSTRAINT "TaskMessage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
