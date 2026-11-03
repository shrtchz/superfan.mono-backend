-- Existing ad events predate event type tracking and represent a view start.
CREATE TYPE "AdEventType" AS ENUM ('VIEW_START', 'COMPLETION', 'CLICK');

ALTER TABLE "AdEvent"
ADD COLUMN "eventType" "AdEventType" NOT NULL DEFAULT 'VIEW_START';
