-- DropForeignKey
ALTER TABLE "TaskMessage" DROP CONSTRAINT "TaskMessage_taskId_fkey";

-- AddForeignKey
ALTER TABLE "TaskMessage" ADD CONSTRAINT "TaskMessage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
