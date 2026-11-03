-- Add lifetimePoints to the User model for denormalized lifetime point totals
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS lifetime_points INTEGER NOT NULL DEFAULT 0;

-- Backfill existing lifetime points from Point history
UPDATE "User" u
SET lifetime_points = sub.total
FROM (
  SELECT "userId", COALESCE(SUM(points), 0) AS total
  FROM "Point"
  GROUP BY "userId"
) sub
WHERE u.id = sub."userId";
