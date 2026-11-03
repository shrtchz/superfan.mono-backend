-- Add authoritative quizTimeSeconds storage and preserve formatted quizTime
ALTER TABLE "ongoing_quizzes"
ADD COLUMN "quizTimeSeconds" INTEGER;

ALTER TABLE "QuizLeaderboard"
ADD COLUMN "quizTimeSeconds" INTEGER;

-- Backfill existing numeric quizTime values in ongoing_quizzes to quizTimeSeconds
UPDATE "ongoing_quizzes"
SET "quizTimeSeconds" = CASE
  WHEN "quizTime" ~ '^\\d+$' THEN CAST("quizTime" AS INTEGER)
  WHEN "quizTime" ~ '^\\d+:[0-5]?\\d$' THEN
    (CAST(split_part("quizTime", ':', 1) AS INTEGER) * 60) + CAST(split_part("quizTime", ':', 2) AS INTEGER)
  ELSE NULL
END
WHERE "quizTime" IS NOT NULL;

-- Backfill existing numeric quizTime values in QuizLeaderboard to quizTimeSeconds
UPDATE "QuizLeaderboard"
SET "quizTimeSeconds" = CASE
  WHEN "quizTime" ~ '^\\d+$' THEN CAST("quizTime" AS INTEGER)
  WHEN "quizTime" ~ '^\\d+:[0-5]?\\d$' THEN
    (CAST(split_part("quizTime", ':', 1) AS INTEGER) * 60) + CAST(split_part("quizTime", ':', 2) AS INTEGER)
  ELSE NULL
END
WHERE "quizTime" IS NOT NULL;
