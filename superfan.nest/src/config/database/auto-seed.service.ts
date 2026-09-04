import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AutoSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AutoSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      // 1. Check if tables exist by probing Role table
      let tablesExist = true;
      try {
        await this.prisma.role.count();
      } catch {
        tablesExist = false;
      }

      // 2. If missing, create ALL tables directly via SQL — no CLI, no shell, no config issues
      if (!tablesExist) {
        this.logger.log('🔨 Database tables are missing. Creating schema via SQL...');
        await this.createAllTables();
        this.logger.log('✅ All database tables created successfully!');
      }

      // 3. Seed base data only if Role table is empty
      const roleCount = await this.prisma.role.count().catch(() => 0);
      if (roleCount === 0) {
        this.logger.log('🌱 No seed data found. Running auto-seed...');
        const seedModule = require('../../../prisma/seed/seed');
        if (typeof seedModule.seedAll === 'function') {
          await seedModule.seedAll(this.prisma);
        }
        this.logger.log('✅ Auto-seed completed successfully!');
      }
    } catch (error: any) {
      this.logger.warn(`Auto-seed/schema init error: ${error?.message || error}`);
    }
  }

  private async createAllTables() {
    // Run each statement individually — DDL cannot run in a transaction in PostgreSQL
    for (const stmt of this.getSchemaSql()) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;
      try {
        await this.prisma.$executeRawUnsafe(trimmed);
      } catch (err: any) {
        if (!err?.message?.includes('already exists')) {
          this.logger.warn(`DDL warning: ${err?.message}`);
        }
      }
    }
  }

  private getSchemaSql(): string[] {
    return [
      // ─── ENUMS ────────────────────────────────────────────────────────────
      `DO $$ BEGIN CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE','PREMIUM_PRO','PREMIUM_PRO_MAX'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "TestLevel" AS ENUM ('basic','intermediate','advanced'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "KycStatus" AS ENUM ('UNVERIFIED','PENDING','VERIFIED','REJECTED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "KycTier" AS ENUM ('TIER_0','TIER_1'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "QuestionPreference" AS ENUM ('5','25','50','100','200','400','1000'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "TimePreference" AS ENUM ('5','25','15','30','45','60','unlimited'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "ReferralStatus" AS ENUM ('CLICKED','SIGNED_UP','FIRST_TEST_COMPLETED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "EarningStatus" AS ENUM ('PENDING','AVAILABLE','PAID_OUT'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "PayoutStatus" AS ENUM ('COMPLETED','PENDING'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "PayoutMethod" AS ENUM ('BUSHA','FLUTTERWAVE','MONNIFY'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "TaskPriority" AS ENUM ('HIGH','MEDIUM','LOW'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "TaskStatus" AS ENUM ('PENDING','COMPLETED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "HistoryType" AS ENUM ('REPORT','FEEDBACK'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "SubmittedBy" AS ENUM ('ADMIN','USER','SYSTEM'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "ActivityType" AS ENUM ('user_registered','content_approved','report_submitted','subadmin_registered','credit','debit'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "ActivityStatus" AS ENUM ('PENDING','SUCCESS','FAILED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "BankTransferStatus" AS ENUM ('PENDING','PAID','EXPIRED','FAILED','CANCELLED','SUCCESS'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "OrderStatus" AS ENUM ('ORDERED','PROCESSING','SHIPPED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "ReturnStatus" AS ENUM ('PENDING','APPROVED','REJECTED','COMPLETED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "AdStatus" AS ENUM ('PENDING','ACTIVE','PAUSED','COMPLETED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE "AdEventType" AS ENUM ('VIEW_START','COMPLETION','CLICK'); EXCEPTION WHEN duplicate_object THEN null; END $$`,

      // ─── ROLE / PERMISSION ─────────────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS "Role" (
        "id" SERIAL PRIMARY KEY,
        "name" TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS "Permission" (
        "id" SERIAL PRIMARY KEY,
        "name" TEXT NOT NULL UNIQUE,
        "description" TEXT
      )`,

      `CREATE TABLE IF NOT EXISTS "RolePermission" (
        "id" SERIAL PRIMARY KEY,
        "roleId" INTEGER NOT NULL REFERENCES "Role"("id") ON DELETE CASCADE,
        "permissionId" INTEGER NOT NULL REFERENCES "Permission"("id") ON DELETE CASCADE,
        UNIQUE("roleId","permissionId")
      )`,

      // ─── USER ──────────────────────────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS "User" (
        "id" SERIAL PRIMARY KEY,
        "firstName" TEXT NOT NULL,
        "lastName" TEXT,
        "email" TEXT NOT NULL UNIQUE,
        "password" TEXT NOT NULL,
        "username" TEXT NOT NULL UNIQUE,
        "referral_code" TEXT UNIQUE,
        "phone" TEXT,
        "clerkUserId" TEXT UNIQUE,
        "roleName" TEXT NOT NULL,
        "login_timestamp" TIMESTAMP(3),
        "active" BOOLEAN NOT NULL DEFAULT false,
        "verificationCode" TEXT,
        "verificationCodeExpiry" TIMESTAMP(3),
        "profilePicture" TEXT,
        "verify_photo" TEXT,
        "address" TEXT,
        "bvn" TEXT,
        "country" TEXT,
        "postal_code" TEXT,
        "dob" TIMESTAMP(3),
        "nin" TEXT,
        "resetToken" TEXT,
        "resetTokenExpiry" TIMESTAMP(3),
        "banReason" TEXT,
        "unBanReason" TEXT,
        "banCategory" TEXT,
        "userCode" TEXT,
        "isBanned" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "state" TEXT,
        "referredByCode" TEXT,
        "languagePreference" TEXT,
        "subjectPreference" TEXT,
        "subscriptionPlan" "SubscriptionPlan",
        "testLevel" "TestLevel",
        "login_method" TEXT,
        "ip_address" TEXT,
        "isOnline" BOOLEAN NOT NULL DEFAULT false,
        "lastSeen" TIMESTAMP(3),
        "subAccountCode" TEXT,
        "accountNumber" TEXT,
        "accounts" JSONB,
        "bankCode" TEXT,
        "location" TEXT,
        "flw_customer_id" TEXT,
        "busha_customer_id" TEXT,
        "busha_balance_id" TEXT,
        "bitnob_customer_id" TEXT,
        "kyc_status" "KycStatus" NOT NULL DEFAULT 'UNVERIFIED',
        "kyc_tier" "KycTier" NOT NULL DEFAULT 'TIER_0',
        "didit_session_id" TEXT UNIQUE,
        "didit_verification_id" TEXT,
        "kyc_rejection_reason" TEXT,
        "kyc_verified_at" TIMESTAMP(3),
        "lifetime_points" INTEGER NOT NULL DEFAULT 0,
        "dailyStreak" INTEGER NOT NULL DEFAULT 0,
        "lastStreakDate" TIMESTAMP(3),
        "questionPreference" "QuestionPreference",
        "timePreference" "TimePreference",
        "accountReference" TEXT
      )`,

      `CREATE TABLE IF NOT EXISTS "Admin" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
        "roleId" INTEGER NOT NULL REFERENCES "Role"("id") ON DELETE CASCADE
      )`,

      `CREATE TABLE IF NOT EXISTS "SubAdmin" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
        "roleId" INTEGER NOT NULL REFERENCES "Role"("id") ON DELETE CASCADE
      )`,

      `CREATE TABLE IF NOT EXISTS "SubAdminInvite" (
        "id" SERIAL PRIMARY KEY,
        "email" TEXT NOT NULL,
        "token" TEXT NOT NULL UNIQUE,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "invitedById" INTEGER REFERENCES "User"("id")
      )`,

      `CREATE TABLE IF NOT EXISTS "SubAdminPermission" (
        "id" SERIAL PRIMARY KEY,
        "subAdminId" INTEGER REFERENCES "SubAdmin"("id") ON DELETE CASCADE,
        "permissionId" INTEGER NOT NULL REFERENCES "Permission"("id") ON DELETE CASCADE,
        "inviteId" INTEGER REFERENCES "SubAdminInvite"("id"),
        UNIQUE("inviteId","permissionId")
      )`,

      // ─── WALLET ────────────────────────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS "Wallet" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
        "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "goldBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "personalBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "usdcBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "usdtBalance" DOUBLE PRECISION NOT NULL DEFAULT 0
      )`,

      `CREATE TABLE IF NOT EXISTS "WalletTransaction" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "amount" DOUBLE PRECISION NOT NULL,
        "type" TEXT,
        "currency" TEXT NOT NULL DEFAULT 'NGN',
        "username" TEXT,
        "account_name" TEXT,
        "payment_method" TEXT,
        "bank_name" TEXT,
        "cardToken" TEXT,
        "wallet_address" TEXT,
        "account_no" TEXT,
        "account_type" TEXT,
        "settlement_date" TIMESTAMP(3),
        "reference" TEXT,
        "status" TEXT,
        "total_earnings" DOUBLE PRECISION,
        "payouts" DOUBLE PRECISION,
        "last_payout" TIMESTAMP(3),
        "payment_date" TIMESTAMP(3),
        "pending_balance" DOUBLE PRECISION,
        "rewardType" TEXT,
        "transactionType" TEXT,
        "description" TEXT,
        "trx_ref" TEXT,
        "holdUntil" TIMESTAMP(3),
        "walletId" INTEGER,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE INDEX IF NOT EXISTS "WalletTx_userId_createdAt_idx" ON "WalletTransaction"("userId","createdAt")`,
      `CREATE INDEX IF NOT EXISTS "WalletTx_type_idx" ON "WalletTransaction"("type")`,
      `CREATE INDEX IF NOT EXISTS "WalletTx_status_idx" ON "WalletTransaction"("status")`,

      `CREATE TABLE IF NOT EXISTS "ActivityWallet" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "type" "ActivityType" NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "amount" DOUBLE PRECISION NOT NULL,
        "currency" TEXT NOT NULL,
        "reference" TEXT,
        "status" "ActivityStatus" NOT NULL,
        "metadata" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "ActivityMonitor" (
        "id" SERIAL PRIMARY KEY,
        "type" "ActivityType" NOT NULL,
        "actorId" INTEGER,
        "actorName" TEXT NOT NULL,
        "actorEmail" TEXT NOT NULL,
        "metadata" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      // ─── NOTIFICATIONS / REFERRALS ─────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS "Notification" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "title" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "amount" DOUBLE PRECISION,
        "type" TEXT,
        "read" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "Referral" (
        "id" SERIAL PRIMARY KEY,
        "referrerId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "refereeId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "status" "ReferralStatus" NOT NULL DEFAULT 'SIGNED_UP',
        "signupRewardGiven" BOOLEAN NOT NULL DEFAULT false,
        "testRewardGiven" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "Reward" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "userId" INTEGER NOT NULL,
        "amount" INTEGER NOT NULL,
        "currency" TEXT NOT NULL,
        "reference" TEXT,
        "type" TEXT NOT NULL,
        "status" "EarningStatus" NOT NULL DEFAULT 'PENDING',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "Point" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "userId" INTEGER NOT NULL,
        "points" INTEGER NOT NULL,
        "reference" TEXT,
        "type" TEXT NOT NULL,
        "accountType" TEXT NOT NULL DEFAULT 'Gold',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      // ─── PAYMENT ───────────────────────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS "PaymentProcessor" (
        "id" SERIAL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "publicKey" TEXT,
        "secretKey" TEXT,
        "isEnabled" BOOLEAN NOT NULL DEFAULT false,
        "isConnected" BOOLEAN NOT NULL DEFAULT false,
        "lastSync" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "PaymentPlan" (
        "id" SERIAL PRIMARY KEY,
        "name" TEXT NOT NULL UNIQUE,
        "amount" TEXT,
        "interval" TEXT,
        "duration" INTEGER,
        "payment_plan_id" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "Subscription" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL,
        "subscriptionPlan" "SubscriptionPlan" NOT NULL,
        "status" TEXT NOT NULL,
        "amount" INTEGER NOT NULL,
        "debitAmount" INTEGER NOT NULL,
        "startDate" TIMESTAMP(3) NOT NULL,
        "endDate" TIMESTAMP(3) NOT NULL,
        "paymentMethod" TEXT,
        "mandateReference" TEXT,
        "paymentReference" TEXT,
        "cardToken" TEXT,
        "paymentDates" JSONB,
        "paymentStatus" TEXT NOT NULL,
        "mandateCode" TEXT
      )`,

      `CREATE TABLE IF NOT EXISTS "SubscriptionDebit" (
        "id" SERIAL PRIMARY KEY,
        "subscriptionId" INTEGER NOT NULL REFERENCES "Subscription"("id") ON DELETE CASCADE,
        "amount" INTEGER NOT NULL,
        "debitDate" TIMESTAMP(3) NOT NULL,
        "paymentReference" TEXT NOT NULL UNIQUE,
        "transactionRef" TEXT,
        "status" TEXT NOT NULL,
        "narration" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "CardFunding" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "walletId" INTEGER,
        "amount" DOUBLE PRECISION NOT NULL,
        "currency" TEXT NOT NULL,
        "reference" TEXT NOT NULL UNIQUE,
        "flwRef" TEXT,
        "status" TEXT NOT NULL,
        "cardLast4" TEXT,
        "cardToken" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "BankTransfer" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "transactionReference" TEXT NOT NULL UNIQUE,
        "paymentReference" TEXT NOT NULL UNIQUE,
        "accountNumber" TEXT NOT NULL,
        "accountName" TEXT NOT NULL,
        "bankName" TEXT NOT NULL,
        "bankCode" TEXT NOT NULL,
        "amount" DECIMAL(18,2) NOT NULL,
        "fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
        "totalPayable" DECIMAL(18,2) NOT NULL,
        "ussdPayment" TEXT,
        "collectionChannel" TEXT,
        "productInformation" TEXT,
        "status" "BankTransferStatus" NOT NULL DEFAULT 'PENDING',
        "requestTime" TIMESTAMP(3) NOT NULL,
        "expiresOn" TIMESTAMP(3) NOT NULL,
        "accountDurationSeconds" INTEGER NOT NULL,
        "paidAt" TIMESTAMP(3),
        "completedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "Payout" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "amount" DOUBLE PRECISION NOT NULL,
        "method" "PayoutMethod" NOT NULL,
        "reference" TEXT NOT NULL UNIQUE,
        "currency" TEXT NOT NULL,
        "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
        "provider" TEXT,
        "metadata" JSONB,
        "providerRef" TEXT,
        "processedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "UserWithdrawalBank" (
        "id" SERIAL PRIMARY KEY,
        "accountName" TEXT NOT NULL,
        "accountNumber" TEXT NOT NULL,
        "bankName" TEXT NOT NULL,
        "bankCode" TEXT NOT NULL,
        "userId" INTEGER NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "UserWithdrawalWallet" (
        "id" SERIAL PRIMARY KEY,
        "walletAddress" TEXT NOT NULL,
        "recipientId" TEXT,
        "symbol" TEXT NOT NULL,
        "network" TEXT NOT NULL,
        "userId" INTEGER NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "UserCard" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL REFERENCES "User"("id"),
        "cardToken" TEXT,
        "cardNumber" TEXT,
        "maskedPan" TEXT,
        "cardType" TEXT,
        "expiry" TEXT,
        "issuer" TEXT,
        "country" TEXT,
        "isDefault" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      // ─── CRYPTO ────────────────────────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS "BushaBalance" (
        "id" SERIAL PRIMARY KEY,
        "balance_id" TEXT NOT NULL UNIQUE,
        "currency" TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS "BushaQuotes" (
        "id" SERIAL PRIMARY KEY,
        "quote_id" TEXT NOT NULL UNIQUE,
        "user_id" INTEGER NOT NULL,
        "customer_id" TEXT NOT NULL,
        "source_currency" TEXT NOT NULL,
        "target_currency" TEXT NOT NULL,
        "source_amount" TEXT NOT NULL,
        "target_amount" TEXT NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "BushaTransfer" (
        "id" SERIAL PRIMARY KEY,
        "trf_id" TEXT NOT NULL UNIQUE,
        "status" TEXT NOT NULL,
        "pay_in" JSONB,
        "fees" JSONB,
        "quote_id" TEXT,
        "profile_id" TEXT,
        "source_currency" TEXT,
        "target_currency" TEXT,
        "source_amount" TEXT,
        "target_amount" TEXT,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "bitnobWithdrawal" (
        "id" SERIAL PRIMARY KEY,
        "transactionId" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "address" TEXT NOT NULL,
        "amount" TEXT NOT NULL,
        "currency" TEXT NOT NULL,
        "chain" TEXT NOT NULL,
        "reference" TEXT NOT NULL,
        "userId" INTEGER NOT NULL,
        "memo" TEXT,
        "description" TEXT,
        "hash" TEXT,
        "fee" TEXT,
        "success_timestamp" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS "exchangeRate" (
        "id" SERIAL PRIMARY KEY,
        "fromCurrency" TEXT NOT NULL,
        "toCurrency" TEXT NOT NULL,
        "rate" DOUBLE PRECISION NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("fromCurrency","toCurrency")
      )`,

      // ─── QUIZ ──────────────────────────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS "ongoing_quizzes" (
        "id" TEXT PRIMARY KEY,
        "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "testQuiz" TEXT NOT NULL,
        "subject" TEXT NOT NULL,
        "testLevel" TEXT NOT NULL,
        "totalEarning" INTEGER NOT NULL,
        "totalEarninginUSDC" INTEGER,
        "totalEarninginUSDT" INTEGER,
        "totalEarninginNaira" INTEGER,
        "totalQuestions" INTEGER NOT NULL,
        "totalTime" INTEGER,
        "baseScore" INTEGER,
        "isRandom" BOOLEAN NOT NULL DEFAULT false,
        "submissionMode" TEXT NOT NULL DEFAULT 'interval',
        "accuracyBonus" INTEGER,
        "speedBonus" INTEGER,
        "streakMultiplier" INTEGER,
        "adBonuses" INTEGER,
        "quizTimeSeconds" INTEGER,
        "quizTime" TEXT,
        "timeRemaining" INTEGER NOT NULL,
        "questions" JSONB NOT NULL,
        "answers" JSONB NOT NULL DEFAULT '[]',
        "currentIndex" INTEGER NOT NULL DEFAULT 0,
        "earnedAmount" INTEGER NOT NULL DEFAULT 0,
        "isCompleted" BOOLEAN NOT NULL DEFAULT false,
        "startedAt" TIMESTAMP(3),
        "expiresAt" TIMESTAMP(3),
        "completedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE INDEX IF NOT EXISTS "ongoing_quizzes_userId_idx" ON "ongoing_quizzes"("userId")`,
      `CREATE INDEX IF NOT EXISTS "ongoing_quizzes_userId_isCompleted_idx" ON "ongoing_quizzes"("userId","isCompleted")`,

      `CREATE TABLE IF NOT EXISTS "QuizAttempt" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL,
        "quizId" TEXT NOT NULL UNIQUE REFERENCES "ongoing_quizzes"("id") ON DELETE CASCADE,
        "startedAt" TIMESTAMP(3),
        "expiresAt" TIMESTAMP(3),
        "completedAt" TIMESTAMP(3),
        "isStarted" BOOLEAN NOT NULL,
        "isCompleted" BOOLEAN NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS "ongoing_live_quiz" (
        "id" SERIAL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "quizIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        "streamId" INTEGER,
        "questions" JSONB,
        "answers" JSONB,
        "totalEarning" INTEGER,
        "completed" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "live_quiz_attempts" (
        "id" SERIAL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "quizId" TEXT NOT NULL,
        "ongoingLiveQuizId" INTEGER REFERENCES "ongoing_live_quiz"("id") ON DELETE SET NULL,
        "totalPrize" INTEGER,
        "recipients" INTEGER,
        "unitPrize" INTEGER,
        "earning" INTEGER NOT NULL DEFAULT 0,
        "isWinner" BOOLEAN NOT NULL DEFAULT false,
        "isCompleted" BOOLEAN NOT NULL DEFAULT false,
        "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "completedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("userId","quizId")
      )`,

      `CREATE TABLE IF NOT EXISTS "LiveQuizLeaderboard" (
        "id" SERIAL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "quizId" TEXT NOT NULL,
        "question" TEXT NOT NULL,
        "answer" TEXT NOT NULL,
        "rewardType" TEXT,
        "isWinner" BOOLEAN NOT NULL DEFAULT false,
        "participants" INTEGER NOT NULL DEFAULT 0,
        "unitPrize" INTEGER NOT NULL DEFAULT 0,
        "rewardStatus" TEXT NOT NULL DEFAULT 'pending',
        "quizDate" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "QuizLeaderboard" (
        "id" SERIAL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "quizId" TEXT NOT NULL,
        "subject" TEXT NOT NULL,
        "testLevel" TEXT NOT NULL,
        "score" INTEGER,
        "selectedAnswer" TEXT NOT NULL,
        "quizTimeSeconds" INTEGER,
        "quizTime" TEXT,
        "accuracyBonus" TEXT,
        "position" INTEGER,
        "correctAnswer" TEXT NOT NULL,
        "earning" INTEGER NOT NULL,
        "submittedAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      // ─── TASK ──────────────────────────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS "Task" (
        "id" SERIAL PRIMARY KEY,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "priority" "TaskPriority" NOT NULL,
        "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
        "dueDate" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "assignTo" TEXT NOT NULL,
        "assignmentDate" TIMESTAMP(3) NOT NULL,
        "assignerId" INTEGER NOT NULL,
        "assignerFirstName" TEXT NOT NULL,
        "assignerLastName" TEXT NOT NULL,
        "assignerUserName" TEXT NOT NULL,
        "userId" INTEGER NOT NULL,
        "isDeleted" BOOLEAN NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS "TaskMessage" (
        "id" SERIAL PRIMARY KEY,
        "taskId" INTEGER NOT NULL REFERENCES "Task"("id") ON DELETE CASCADE,
        "senderId" INTEGER NOT NULL,
        "message" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      // ─── MISC ──────────────────────────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS "Quote" (
        "id" SERIAL PRIMARY KEY,
        "text" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "UserHistory" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "creatorId" INTEGER NOT NULL REFERENCES "User"("id"),
        "type" "HistoryType" NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "submittedBy" "SubmittedBy" NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      // ─── STREAM ────────────────────────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS "Stream" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "privacyStatus" TEXT NOT NULL,
        "broadcastId" TEXT,
        "streamId" TEXT,
        "rtmpUrl" TEXT,
        "streamKey" TEXT,
        "networkPlatform" TEXT NOT NULL DEFAULT 'unknown',
        "streamUrl" TEXT,
        "liveTiming" TEXT,
        "preRecordedTiming" TEXT,
        "status" TEXT NOT NULL,
        "scheduledDate" TIMESTAMP(3),
        "category" TEXT,
        "thumbnailUrl" TEXT,
        "recordedVideoUrl" TEXT,
        "duration" TEXT,
        "lockChat" BOOLEAN NOT NULL DEFAULT false,
        "isActive" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "stream_chat_lock_logs" (
        "id" SERIAL PRIMARY KEY,
        "streamId" INTEGER NOT NULL REFERENCES "Stream"("id") ON DELETE CASCADE,
        "adminId" INTEGER NOT NULL,
        "action" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "StreamUserBan" (
        "id" SERIAL PRIMARY KEY,
        "streamId" INTEGER NOT NULL REFERENCES "Stream"("id") ON DELETE CASCADE,
        "userId" INTEGER NOT NULL,
        "banReason" TEXT,
        "bannedBy" INTEGER,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("streamId","userId")
      )`,

      `CREATE TABLE IF NOT EXISTS "StreamComment" (
        "id" SERIAL PRIMARY KEY,
        "streamId" INTEGER NOT NULL REFERENCES "Stream"("id") ON DELETE CASCADE,
        "userId" INTEGER NOT NULL,
        "parentId" INTEGER REFERENCES "StreamComment"("id") ON DELETE CASCADE,
        "rootId" INTEGER REFERENCES "StreamComment"("id") ON DELETE CASCADE,
        "replyToUserId" INTEGER,
        "depth" INTEGER NOT NULL DEFAULT 0,
        "legacyReplyId" INTEGER UNIQUE,
        "message" TEXT NOT NULL,
        "likesCount" INTEGER NOT NULL DEFAULT 0,
        "reportsCount" INTEGER NOT NULL DEFAULT 0,
        "isDeleted" BOOLEAN NOT NULL,
        "isWinner" BOOLEAN NOT NULL DEFAULT false,
        "isPinned" BOOLEAN NOT NULL DEFAULT false,
        "winAmount" DOUBLE PRECISION,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "CommentReply" (
        "id" SERIAL PRIMARY KEY,
        "commentId" INTEGER NOT NULL REFERENCES "StreamComment"("id"),
        "userId" INTEGER NOT NULL,
        "message" TEXT NOT NULL,
        "likesCount" INTEGER NOT NULL DEFAULT 0,
        "reportsCount" INTEGER NOT NULL DEFAULT 0,
        "isDeleted" BOOLEAN NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "CommentLike" (
        "id" SERIAL PRIMARY KEY,
        "commentId" INTEGER NOT NULL REFERENCES "StreamComment"("id") ON DELETE CASCADE,
        "userId" INTEGER NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("commentId","userId")
      )`,

      `CREATE TABLE IF NOT EXISTS "CommentReplyLike" (
        "id" SERIAL PRIMARY KEY,
        "replyId" INTEGER NOT NULL REFERENCES "CommentReply"("id") ON DELETE CASCADE,
        "userId" INTEGER NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("replyId","userId")
      )`,

      `CREATE TABLE IF NOT EXISTS "CommentReport" (
        "id" SERIAL PRIMARY KEY,
        "commentId" INTEGER NOT NULL REFERENCES "StreamComment"("id") ON DELETE CASCADE,
        "userId" INTEGER NOT NULL,
        "reason" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("commentId","userId")
      )`,

      `CREATE TABLE IF NOT EXISTS "CommentReplyReport" (
        "id" SERIAL PRIMARY KEY,
        "replyId" INTEGER NOT NULL REFERENCES "CommentReply"("id") ON DELETE CASCADE,
        "userId" INTEGER NOT NULL,
        "reason" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("replyId","userId")
      )`,

      `CREATE TABLE IF NOT EXISTS "YouTubeToken" (
        "id" SERIAL PRIMARY KEY,
        "service" TEXT NOT NULL UNIQUE DEFAULT 'youtube',
        "accessToken" TEXT,
        "refreshToken" TEXT,
        "expiryDate" TIMESTAMP(3),
        "scope" TEXT,
        "tokenType" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      // ─── PRODUCT / ORDER ───────────────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS "Product" (
        "id" SERIAL PRIMARY KEY,
        "title" TEXT NOT NULL,
        "price" TEXT NOT NULL,
        "priceAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        "colors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        "sizes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        "badge" TEXT,
        "description" TEXT,
        "stock" INTEGER NOT NULL DEFAULT 100,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "Order" (
        "id" SERIAL PRIMARY KEY,
        "orderNumber" TEXT NOT NULL UNIQUE,
        "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "status" "OrderStatus" NOT NULL DEFAULT 'ORDERED',
        "totalAmount" DOUBLE PRECISION NOT NULL,
        "currency" TEXT NOT NULL DEFAULT 'NGN',
        "shippingFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "vatAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "paymentMethod" TEXT NOT NULL,
        "subWallet" TEXT,
        "paymentStatus" TEXT NOT NULL DEFAULT 'PAID',
        "fullName" TEXT NOT NULL,
        "country" TEXT NOT NULL,
        "address" TEXT NOT NULL,
        "phoneCode" TEXT NOT NULL,
        "phoneNumber" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE INDEX IF NOT EXISTS "Order_userId_idx" ON "Order"("userId")`,

      `CREATE TABLE IF NOT EXISTS "OrderItem" (
        "id" SERIAL PRIMARY KEY,
        "orderId" INTEGER NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
        "productId" INTEGER REFERENCES "Product"("id"),
        "productName" TEXT NOT NULL,
        "productImage" TEXT,
        "price" DOUBLE PRECISION NOT NULL,
        "quantity" INTEGER NOT NULL DEFAULT 1,
        "color" TEXT,
        "size" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId")`,

      `CREATE TABLE IF NOT EXISTS "OrderReturn" (
        "id" SERIAL PRIMARY KEY,
        "orderId" INTEGER NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
        "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "productId" INTEGER,
        "productName" TEXT NOT NULL,
        "productImage" TEXT,
        "price" DOUBLE PRECISION NOT NULL,
        "reason" TEXT NOT NULL,
        "refundMethod" TEXT NOT NULL DEFAULT 'mastercard',
        "status" "ReturnStatus" NOT NULL DEFAULT 'PENDING',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      // ─── ADS ───────────────────────────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS "AdCampaign" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER,
        "username" TEXT,
        "headline" TEXT NOT NULL,
        "description" TEXT,
        "buttonLabel" TEXT,
        "websiteUrl" TEXT,
        "mediaUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        "mediaType" TEXT,
        "dailyFee" INTEGER NOT NULL DEFAULT 500,
        "totalFee" INTEGER NOT NULL,
        "days" INTEGER NOT NULL DEFAULT 1,
        "startDate" TIMESTAMP(3) NOT NULL,
        "endDate" TIMESTAMP(3),
        "runContinuously" BOOLEAN NOT NULL DEFAULT true,
        "ageRange" TEXT,
        "status" "AdStatus" NOT NULL DEFAULT 'PENDING',
        "views" INTEGER NOT NULL DEFAULT 0,
        "clicks" INTEGER NOT NULL DEFAULT 0,
        "paymentStatus" TEXT NOT NULL DEFAULT 'PENDING',
        "paymentRef" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "AdPlacement" (
        "id" SERIAL PRIMARY KEY,
        "campaignId" INTEGER NOT NULL REFERENCES "AdCampaign"("id") ON DELETE CASCADE,
        "key" TEXT NOT NULL,
        "mediaUrl" TEXT NOT NULL,
        "durationSec" INTEGER NOT NULL DEFAULT 30,
        "skipAllowed" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS "AdEvent" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER,
        "campaignId" INTEGER NOT NULL REFERENCES "AdCampaign"("id") ON DELETE CASCADE,
        "placementId" INTEGER REFERENCES "AdPlacement"("id") ON DELETE SET NULL,
        "quizId" TEXT,
        "eventType" "AdEventType" NOT NULL DEFAULT 'VIEW_START',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      // ─── _prisma_migrations tracking ─────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" VARCHAR(36) PRIMARY KEY,
        "checksum" VARCHAR(64) NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "migration_name" VARCHAR(255) NOT NULL,
        "logs" TEXT,
        "rolled_back_at" TIMESTAMPTZ,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      )`,
    ];
  }
}
