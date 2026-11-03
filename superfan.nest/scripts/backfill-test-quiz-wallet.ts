/**
 * backfill-test-quiz-wallet.ts
 *
 * One-shot migration that fixes wallet history for completed test quizzes:
 *
 *  1. Removes duplicate WalletTransaction / ActivityWallet / Reward / Point rows
 *     that were created by retried quiz submissions (keeps the FIRST credit per quiz).
 *  2. Re-calculates the correct Naira amount from the stored totalPoints and
 *     the current POINTS_TO_NAIRA_RATE (default 1000) and updates any row whose
 *     amount differs (catches the NaN-amount bug and any old wrong-rate records).
 *  3. Deduplicates quizLeaderboard rows — keeps the most recent row per
 *     (userId, quizId) combination.
 *  4. Deduplicates Point rows — keeps the first per (userId, reference, type).
 *  5. Corrects lifetimePoints counter by recalculating from unique Point rows.
 *
 * Usage (from superfan.mono-backend/superfan.nest directory):
 *   DRY_RUN=true  npx ts-node -r tsconfig-paths/register scripts/backfill-test-quiz-wallet.ts
 *   DRY_RUN=false npx ts-node -r tsconfig-paths/register scripts/backfill-test-quiz-wallet.ts
 *
 * Safe to re-run — all operations are idempotent.
 */

import { prisma } from '../src/prisma/prisma';

const DRY_RUN = process.env.DRY_RUN !== 'false'; // defaults to DRY_RUN for safety
const POINTS_TO_NAIRA_RATE = (() => {
  const v = parseInt(process.env.POINTS_TO_NAIRA_RATE ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 1000;
})();

function pts2ngn(points: number): number {
  return points / POINTS_TO_NAIRA_RATE;
}

function roundNgn(n: number): number {
  return Math.round(n * 100000) / 100000; // 5dp precision
}

async function main() {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Test-Quiz Wallet Backfill
  Mode           : ${DRY_RUN ? 'DRY RUN (no writes)' : '✏️  WRITE'}
  Rate           : ${POINTS_TO_NAIRA_RATE} PTS = ₦1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  // ── 1. Load all completed test quiz sessions ────────────────────────────────
  const sessions = await (prisma.ongoingQuiz as any).findMany({
    where: { isCompleted: true },
    select: {
      id: true,
      userId: true,
      totalEarning: true,
      baseScore: true,
      accuracyBonus: true,
      speedBonus: true,
      streakMultiplier: true,
      adBonuses: true,
      completedAt: true,
    },
    orderBy: { completedAt: 'asc' },
  });

  console.log(`Found ${sessions.length} completed ongoingQuiz sessions\n`);

  let rewardFixed = 0, rewardDupRemoved = 0;
  let walletTxFixed = 0, walletTxDupRemoved = 0;
  let activityFixed = 0, activityDupRemoved = 0;
  let pointDupRemoved = 0, lifetimeFixed = 0;
  let leaderboardDupRemoved = 0;

  // ── 2. Process each session ─────────────────────────────────────────────────
  for (const session of sessions) {
    const userId = Number(session.userId);
    const quizId = session.id;
    const ref = `quiz_reward:${userId}:${quizId}`;

    // Correct amount = totalPoints / rate
    // totalPoints was stored across several columns; reconstruct it.
    const storedNaira = Number(session.totalEarning ?? 0);
    // Re-derive points from stored Naira (inverse of the conversion)
    // OR use the column breakdown if available:
    const base = Number(session.baseScore ?? 0);
    const accuracy = Number(session.accuracyBonus ?? 0);
    const speed = Number(session.speedBonus ?? 0);
    const streak = Number(session.streakMultiplier ?? 0);
    const ads = Number(session.adBonuses ?? 0);
    const totalPoints = base + accuracy + speed + streak + ads;
    const correctNaira = totalPoints > 0 ? pts2ngn(totalPoints) : storedNaira;

    // ── 2a. Reward rows ───────────────────────────────────────────────────────
    const rewards = await (prisma.reward as any).findMany({
      where: { userId, type: 'quiz_reward', reference: ref },
      orderBy: { createdAt: 'asc' },
    });

    if (rewards.length > 1) {
      const toDelete = rewards.slice(1).map((r: any) => r.id);
      if (!DRY_RUN) {
        await (prisma.reward as any).deleteMany({ where: { id: { in: toDelete } } });
      }
      console.log(`  🗑  Reward dups userId=${userId} quizId=${quizId}: removed ${toDelete.length}`);
      rewardDupRemoved += toDelete.length;
    }
    const keepReward = rewards[0];
    if (keepReward && correctNaira > 0) {
      const diff = Math.abs(Number(keepReward.amount) - correctNaira);
      if (diff > 0.000001) {
        if (!DRY_RUN) {
          await (prisma.reward as any).update({
            where: { id: keepReward.id },
            data: { amount: correctNaira },
          });
        }
        console.log(
          `  ✅ Reward #${keepReward.id} userId=${userId}: ₦${Number(keepReward.amount).toFixed(5)} → ₦${correctNaira.toFixed(5)}`,
        );
        rewardFixed++;
      }
    }

    // ── 2b. WalletTransaction rows ────────────────────────────────────────────
    const txWindow = session.completedAt
      ? {
          gte: new Date(new Date(session.completedAt).getTime() - 60 * 60 * 1000),
          lte: new Date(new Date(session.completedAt).getTime() + 60 * 60 * 1000),
        }
      : undefined;

    const walletTxs = await (prisma.walletTransaction as any).findMany({
      where: {
        userId,
        type: 'credit',
        description: 'Test Quiz Earning',
        ...(txWindow ? { createdAt: txWindow } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    if (walletTxs.length > 1) {
      const toDelete = walletTxs.slice(1).map((t: any) => t.id);
      if (!DRY_RUN) {
        await (prisma.walletTransaction as any).deleteMany({ where: { id: { in: toDelete } } });
        // Reverse the duplicate credits from the wallet balance
        const dupAmount = walletTxs.slice(1).reduce((s: number, t: any) => s + Number(t.amount), 0);
        await (prisma.wallet as any).update({
          where: { userId },
          data: {
            balance: { decrement: dupAmount },
            goldBalance: { decrement: dupAmount },
          },
        });
      }
      console.log(
        `  🗑  WalletTx dups userId=${userId} quizId=${quizId}: removed ${toDelete.length}`,
      );
      walletTxDupRemoved += toDelete.length;
    }
    const keepTx = walletTxs[0];
    if (keepTx && correctNaira > 0) {
      const diff = Math.abs(Number(keepTx.amount) - correctNaira);
      if (diff > 0.000001) {
        const delta = correctNaira - Number(keepTx.amount);
        if (!DRY_RUN) {
          await (prisma.walletTransaction as any).update({
            where: { id: keepTx.id },
            data: { amount: correctNaira },
          });
          await (prisma.wallet as any).update({
            where: { userId },
            data: {
              balance: { increment: delta },
              goldBalance: { increment: delta },
            },
          });
        }
        console.log(
          `  ✅ WalletTx #${keepTx.id} userId=${userId}: ₦${Number(keepTx.amount).toFixed(5)} → ₦${correctNaira.toFixed(5)} (delta ${delta > 0 ? '+' : ''}${delta.toFixed(5)})`,
        );
        walletTxFixed++;
      }
    }

    // ── 2c. ActivityWallet rows ───────────────────────────────────────────────
    const activities = await (prisma.activityWallet as any).findMany({
      where: {
        userId,
        title: 'Test Quiz Earning',
        ...(txWindow ? { createdAt: txWindow } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    if (activities.length > 1) {
      const toDelete = activities.slice(1).map((a: any) => a.id);
      if (!DRY_RUN) {
        await (prisma.activityWallet as any).deleteMany({ where: { id: { in: toDelete } } });
      }
      console.log(
        `  🗑  ActivityWallet dups userId=${userId} quizId=${quizId}: removed ${toDelete.length}`,
      );
      activityDupRemoved += toDelete.length;
    }
    const keepActivity = activities[0];
    if (keepActivity && correctNaira > 0) {
      const diff = Math.abs(Number(keepActivity.amount) - correctNaira);
      if (diff > 0.000001) {
        if (!DRY_RUN) {
          await (prisma.activityWallet as any).update({
            where: { id: keepActivity.id },
            data: { amount: correctNaira },
          });
        }
        console.log(
          `  ✅ ActivityWallet #${keepActivity.id} userId=${userId}: ₦${Number(keepActivity.amount).toFixed(5)} → ₦${correctNaira.toFixed(5)}`,
        );
        activityFixed++;
      }
    }
  }

  // ── 3. Deduplicate quizLeaderboard rows ────────────────────────────────────
  console.log('\n── QuizLeaderboard dedup ──');
  const allLeaderboardRows = await (prisma.quizLeaderboard as any).findMany({
    select: { id: true, userId: true, quizId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  const seenLb = new Set<string>();
  const lbDupIds: number[] = [];
  for (const row of allLeaderboardRows) {
    const key = `${row.userId}:${row.quizId}`;
    if (seenLb.has(key)) {
      lbDupIds.push(row.id);
    } else {
      seenLb.add(key);
    }
  }

  if (lbDupIds.length > 0) {
    if (!DRY_RUN) {
      await (prisma.quizLeaderboard as any).deleteMany({ where: { id: { in: lbDupIds } } });
    }
    console.log(`  🗑  QuizLeaderboard dups removed: ${lbDupIds.length}`);
    leaderboardDupRemoved = lbDupIds.length;
  } else {
    console.log('  ✓ No duplicate quizLeaderboard rows found');
  }

  // ── 4. Deduplicate Point rows and fix lifetimePoints ───────────────────────
  console.log('\n── Point row dedup & lifetimePoints fix ──');
  const allPoints = await (prisma.point as any).findMany({
    where: { type: 'quiz_reward' },
    select: { id: true, userId: true, reference: true, points: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const seenPts = new Map<string, number>(); // key → id of keeper
  const ptsDupIds: number[] = [];
  for (const row of allPoints) {
    const key = `${row.userId}:${row.reference}`;
    if (seenPts.has(key)) {
      ptsDupIds.push(row.id);
    } else {
      seenPts.set(key, row.id);
    }
  }

  if (ptsDupIds.length > 0) {
    if (!DRY_RUN) {
      await (prisma.point as any).deleteMany({ where: { id: { in: ptsDupIds } } });
    }
    console.log(`  🗑  Point dups removed: ${ptsDupIds.length}`);
    pointDupRemoved = ptsDupIds.length;
  }

  // Fix lifetimePoints: recalculate from surviving unique Point rows per user
  const allRemainingPoints = await (prisma.point as any).findMany({
    select: { userId: true, points: true },
  });
  const pointsByUser = new Map<number, number>();
  for (const row of allRemainingPoints) {
    pointsByUser.set(row.userId, (pointsByUser.get(row.userId) ?? 0) + Number(row.points));
  }

  for (const [userId, correctLifetime] of pointsByUser) {
    const user = await (prisma.user as any).findUnique({
      where: { id: userId },
      select: { id: true, lifetimePoints: true },
    });
    if (!user) continue;
    const diff = Math.abs(Number(user.lifetimePoints) - correctLifetime);
    if (diff > 0) {
      if (!DRY_RUN) {
        await (prisma.user as any).update({
          where: { id: userId },
          data: { lifetimePoints: correctLifetime },
        });
      }
      console.log(
        `  ✅ lifetimePoints userId=${userId}: ${user.lifetimePoints} → ${correctLifetime}`,
      );
      lifetimeFixed++;
    }
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Backfill complete${DRY_RUN ? ' (DRY RUN — no writes made)' : ''}

  Reward rows amount-fixed     : ${rewardFixed}
  Reward duplicate rows removed: ${rewardDupRemoved}
  WalletTx amount-fixed        : ${walletTxFixed}
  WalletTx duplicate removed   : ${walletTxDupRemoved}
  ActivityWallet amount-fixed  : ${activityFixed}
  ActivityWallet dup removed   : ${activityDupRemoved}
  QuizLeaderboard dup removed  : ${leaderboardDupRemoved}
  Point dup rows removed       : ${pointDupRemoved}
  lifetimePoints users fixed   : ${lifetimeFixed}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
