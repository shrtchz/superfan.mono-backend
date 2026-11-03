-- AlterTable: link Postgres users to Clerk identity (Phase 2)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "clerkUserId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_clerkUserId_key" ON "User"("clerkUserId");
