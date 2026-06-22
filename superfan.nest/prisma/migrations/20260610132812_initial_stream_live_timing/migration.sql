-- AlterTable
ALTER TABLE "Stream" ADD COLUMN     "duration" TEXT,
ADD COLUMN     "liveTiming" TEXT,
ADD COLUMN     "preRecordedTiming" TEXT,
ADD COLUMN     "recordedVideoUrl" TEXT;
