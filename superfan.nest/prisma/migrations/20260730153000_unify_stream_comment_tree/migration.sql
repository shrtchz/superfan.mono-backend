-- Add unified tree metadata to StreamComment while preserving legacy reply tables.
ALTER TABLE "StreamComment"
  ADD COLUMN IF NOT EXISTS "parentId" INTEGER,
  ADD COLUMN IF NOT EXISTS "rootId" INTEGER,
  ADD COLUMN IF NOT EXISTS "replyToUserId" INTEGER,
  ADD COLUMN IF NOT EXISTS "depth" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "legacyReplyId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'StreamComment_parentId_fkey'
  ) THEN
    ALTER TABLE "StreamComment"
      ADD CONSTRAINT "StreamComment_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "StreamComment"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'StreamComment_rootId_fkey'
  ) THEN
    ALTER TABLE "StreamComment"
      ADD CONSTRAINT "StreamComment_rootId_fkey"
      FOREIGN KEY ("rootId") REFERENCES "StreamComment"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "StreamComment_legacyReplyId_key"
  ON "StreamComment"("legacyReplyId");

CREATE INDEX IF NOT EXISTS "StreamComment_streamId_createdAt_idx"
  ON "StreamComment"("streamId", "createdAt");

CREATE INDEX IF NOT EXISTS "StreamComment_parentId_createdAt_idx"
  ON "StreamComment"("parentId", "createdAt");

CREATE INDEX IF NOT EXISTS "StreamComment_rootId_createdAt_idx"
  ON "StreamComment"("rootId", "createdAt");

CREATE INDEX IF NOT EXISTS "StreamComment_replyToUserId_idx"
  ON "StreamComment"("replyToUserId");

-- Existing StreamComment rows are root comments in the legacy model.
UPDATE "StreamComment"
SET "rootId" = "id",
    "depth" = 0
WHERE "parentId" IS NULL
  AND ("rootId" IS NULL OR "rootId" <> "id");

-- Copy legacy replies into StreamComment so all future actions target one table.
INSERT INTO "StreamComment" (
  "streamId",
  "userId",
  "parentId",
  "rootId",
  "replyToUserId",
  "depth",
  "legacyReplyId",
  "message",
  "likesCount",
  "reportsCount",
  "isDeleted",
  "isWinner",
  "isPinned",
  "winAmount",
  "createdAt",
  "updatedAt"
)
SELECT
  root."streamId",
  reply."userId",
  root."id" AS "parentId",
  root."id" AS "rootId",
  root."userId" AS "replyToUserId",
  1 AS "depth",
  reply."id" AS "legacyReplyId",
  reply."message",
  reply."likesCount",
  reply."reportsCount",
  reply."isDeleted",
  false AS "isWinner",
  false AS "isPinned",
  NULL::DOUBLE PRECISION AS "winAmount",
  reply."createdAt",
  reply."updatedAt"
FROM "CommentReply" reply
INNER JOIN "StreamComment" root
  ON root."id" = reply."commentId"
LEFT JOIN "StreamComment" migrated
  ON migrated."legacyReplyId" = reply."id"
WHERE migrated."id" IS NULL;

-- Move reply likes onto the unified CommentLike table.
DO $$
BEGIN
  IF to_regclass('public.CommentReplyLike') IS NOT NULL THEN
    INSERT INTO "CommentLike" ("commentId", "userId", "createdAt")
    SELECT
      migrated."id" AS "commentId",
      reply_like."userId",
      reply_like."createdAt"
    FROM "CommentReplyLike" reply_like
    INNER JOIN "CommentReply" reply
      ON reply."id" = reply_like."replyId"
    INNER JOIN "StreamComment" migrated
      ON migrated."legacyReplyId" = reply."id"
    ON CONFLICT ("commentId", "userId") DO NOTHING;
  END IF;
END $$;

-- Move reply reports onto the unified CommentReport table.
DO $$
BEGIN
  IF to_regclass('public.CommentReplyReport') IS NOT NULL THEN
    INSERT INTO "CommentReport" ("commentId", "userId", "reason", "createdAt")
    SELECT
      migrated."id" AS "commentId",
      reply_report."userId",
      reply_report."reason",
      reply_report."createdAt"
    FROM "CommentReplyReport" reply_report
    INNER JOIN "CommentReply" reply
      ON reply."id" = reply_report."replyId"
    INNER JOIN "StreamComment" migrated
      ON migrated."legacyReplyId" = reply."id"
    ON CONFLICT ("commentId", "userId") DO NOTHING;
  END IF;
END $$;
