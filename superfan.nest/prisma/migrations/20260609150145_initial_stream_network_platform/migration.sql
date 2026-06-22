-- Add column if it doesn't exist (handles fresh DBs / shadow DB)
ALTER TABLE "Stream" ADD COLUMN IF NOT EXISTS "networkPlatform" TEXT NOT NULL DEFAULT 'unknown';

-- Set default on existing column (handles prod DB where column already exists)
ALTER TABLE "Stream" ALTER COLUMN "networkPlatform" SET DEFAULT 'unknown';