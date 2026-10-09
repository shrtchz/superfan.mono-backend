/**
 * backfill-live-quiz-clean.ts
 *
 * FULL CLEAN-SLATE backfill for live quiz wallet entries.
 *
 * Problem: submitLiveQuiz was not idempotent, so every retry (network, re-render)
 * created a new LQ_ wallet credit. The consolation path also fired for winners.
 * Result: users have 2-4× ₦600 duplicate credits + a ₦0.5-0.6 wrong consolation.
 *
 * This script:
 *  1. Deletes ALL "live quiz" wallet entries per user (all patterns below).
 *  2. Corrects each user's wallet balance (reverses deleted amounts).
 *  3. Creates exactly ONE correct credit for each winner from liveQuizAttempt.earning.
 *  4. Creates the reward idempotency anchor so it won't double-run.
 *
 * Patterns deleted:
 *   trx_ref LIKE 'LQ_%'                   → duplicate winner credits from submitLiveQuiz
 *   trx_ref LIKE 'live_quiz_reward:%'     → consolation/winner reward refs
 *   trx_ref LIKE 'live_quiz_winner:%'     → our previous createLiveQuizWinnerReward
 *   trx_ref LIKE 'lqbf_%'                 → our earlier broken backfill
 *   description = 'Live Quiz Prize'        → our earlier backfill entries
 *
 * Usage (from superfan.mono-backend/superfan.nest):
 *   DRY_RUN=true  npx ts-node -r tsconfig-paths/register scripts/backfill-live-quiz-clean.ts
 *   DRY_RUN=false npx ts-node -r tsconfig-paths/register scripts/backfill-live-quiz-clean.ts
 */

import { prisma } from '../src/prisma/prisma';

const DRY_RUN = process.env.DRY_RUN !== 'false';

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(...args: any[]) { console.log(...args); }

/** All trx_ref prefixes / descriptions that belong to live quiz wallet entries */
function isLiveQuizTx(tx: { trx_ref: string | null; description: string | null }) {
  const ref = tx.trx_ref ?? '';
  const desc = tx.description ?? '';
  return (
    ref.startsWith('LQ_') ||
    ref.startsWith('live_quiz_reward:') ||
    ref.startsWith('live_quiz_winner:') ||
    ref.startsWith('lqbf_') ||
    desc === 'Live Quiz Prize' ||
    desc.startsWith('You earned') && desc.includes('Live Quiz')
  );
}

function isLiveQuizActivity(act: { title: string | null; description: string | null }) {
  const title = act.title ?? '';
  const desc = act.description ?? '';
  return (
    title === 'Live Quiz Prize' ||
    title.includes('Live Quiz') ||
    desc.includes('Live Quiz')
  );
}

function isLiveQuizReward(r: { type: string }) {
  return (
    r.type === 'live_quiz_winner' ||
    r.type === 'live_quiz_consolation' ||
    r.type === 'live_quiz_reward' ||
    r.type === 'consolation'
  );
}

async function extractQuizIdFromRef(ref: string | null): Promise<string | null> {
  if (!ref) return null;
  // LQ_<quizId>_<snowflake>
  if (ref.startsWith('LQ_')) {
    const parts = ref.split('_');
    // quizId is parts[1] (24-char hex)
    if (parts.length >= 3) return parts[1];
  }
  // live_quiz_reward:<quizId>:<userId>
  if (ref.startsWith('live_quiz_reward:')) {
    return ref.split(':')[1] ?? null;
  }
  // live_quiz_winner:<userId>:<quizId>
  if (ref.startsWith('live_quiz_winner:')) {
    return ref.split(':')[2] ?? null;
  }
  // lqbf_<userId>_<ts> — no quizId embedded, handled separately
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Live Quiz Wallet Clean-Slate Backfill
  Mode : ${DRY_RUN ? 'DRY RUN (no writes)' : '✏️  WRITE'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  // ── 1. Find ALL live-quiz wallet transactions in the DB ──────────────────
  const allTxs = await prisma.walletTransaction.findMany({
    select: { id: true, userId: true, amount: true, trx_ref: true, description: true },
  });
  const liveQuizTxs = allTxs.filter(isLiveQuizTx);

  log(`Found ${liveQuizTxs.length} live-quiz walletTransaction rows across all users\n`);

  // Group by userId
  const byUser = new Map<number, typeof liveQuizTxs>();
  for (const tx of liveQuizTxs) {
    const uid = Number(tx.userId);
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid)!.push(tx);
  }

  let totalTxDeleted = 0;
  let totalActDeleted = 0;
  let totalRewardDeleted = 0;
  let totalBalanceReversed = 0;
  let totalWinnersReCredited = 0;

  // ── 2. Process each user ─────────────────────────────────────────────────
  for (const [userId, userTxs] of byUser) {
    log(`── userId=${userId} (${userTxs.length} live-quiz tx rows) ──`);

    const deleteAmountSum = userTxs.reduce((s, t) => s + Number(t.amount), 0);
    log(`  🗑  walletTransaction: deleting ${userTxs.length} rows (sum ₦${deleteAmountSum.toFixed(3)})`);
    userTxs.forEach((t) =>
      log(`       #${t.id} ₦${t.amount} ref=${t.trx_ref} desc=${t.description}`),
    );

    if (!DRY_RUN) {
      await prisma.walletTransaction.deleteMany({
        where: { id: { in: userTxs.map((t) => t.id) } },
      });
    }
    totalTxDeleted += userTxs.length;
    totalBalanceReversed += deleteAmountSum;

    // ── 2b. ActivityWallet ─────────────────────────────────────────────────
    const allActs = await prisma.activityWallet.findMany({
      where: { userId },
      select: { id: true, title: true, description: true },
    });
    const liveActs = allActs.filter(isLiveQuizActivity);
    if (liveActs.length > 0) {
      log(`  🗑  activityWallet: deleting ${liveActs.length} rows`);
      if (!DRY_RUN) {
        await prisma.activityWallet.deleteMany({ where: { id: { in: liveActs.map((a) => a.id) } } });
      }
      totalActDeleted += liveActs.length;
    }

    // ── 2c. Reward rows ────────────────────────────────────────────────────
    const allRewards = await prisma.reward.findMany({
      where: { userId },
      select: { id: true, type: true, reference: true },
    });
    const liveRewards = allRewards.filter(isLiveQuizReward);
    if (liveRewards.length > 0) {
      log(`  🗑  reward: deleting ${liveRewards.length} rows`);
      if (!DRY_RUN) {
        await prisma.reward.deleteMany({ where: { id: { in: liveRewards.map((r) => r.id) } } });
      }
      totalRewardDeleted += liveRewards.length;
    }

    // ── 2d. Reverse wallet balance ─────────────────────────────────────────
    log(`  💰 Reversing ₦${deleteAmountSum.toFixed(3)} from wallet`);
    if (!DRY_RUN) {
      await prisma.wallet.update({
        where: { userId },
        data: {
          balance:     { decrement: deleteAmountSum },
          goldBalance: { decrement: deleteAmountSum },
        },
      });
    }

    // ── 2e. Determine unique quizIds for this user from the deleted txs ────
    const quizIdSet = new Set<string>();
    for (const tx of userTxs) {
      const qid = await extractQuizIdFromRef(tx.trx_ref);
      if (qid) quizIdSet.add(qid);
    }

    // ── 2f. Re-credit each winning quizId once ─────────────────────────────
    for (const quizId of quizIdSet) {
      // Look up the attempt (any completion status) to get earning + isWinner
      const attempt = await prisma.liveQuizAttempt.findFirst({
        where: { userId: String(userId), quizId },
        include: { ongoingLiveQuiz: { select: { updatedAt: true } } },
      });

      if (!attempt) {
        log(`  ⚠️  No liveQuizAttempt found for userId=${userId} quizId=${quizId} — skipping credit`);
        continue;
      }

      const earning = Number(attempt.earning ?? 0);
      if (!attempt.isWinner || earning <= 0) {
        log(`  ℹ️  userId=${userId} quizId=${quizId} not a winner or earning=0 — no credit`);
        continue;
      }

      const ts = attempt.completedAt ?? attempt.ongoingLiveQuiz?.updatedAt ?? new Date();
      const rewardRef = `live_quiz_winner:${userId}:${quizId}`;

      log(`  ✅ Winner quizId=${quizId} ₦${earning} @ ${ts.toISOString()}`);

      if (!DRY_RUN) {
        await prisma.reward.create({
          data: { userId, amount: earning, currency: 'NGN', type: 'live_quiz_winner', status: 'PAID_OUT', reference: rewardRef, createdAt: ts },
        });

        await prisma.walletTransaction.create({
          data: {
            userId,
            amount:          earning,
            type:            'credit',
            currency:        'NGN',
            status:          'Completed',
            description:     `You earned ₦${earning} from Live Quiz`,
            account_type:    'Gold',
            transactionType: 'Reward',
            trx_ref:         rewardRef,
            createdAt:       ts,
          },
        });

        await prisma.activityWallet.create({
          data: {
            userId,
            type:        'credit',
            title:       'Live Quiz Prize',
            description: `You won ₦${earning} from Live Quiz`,
            amount:      earning,
            currency:    'NGN',
            status:      'SUCCESS',
            createdAt:   ts,
          },
        });

        await prisma.wallet.update({
          where: { userId },
          data: { balance: { increment: earning }, goldBalance: { increment: earning } },
        });
      }
      totalWinnersReCredited++;
    }

    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      select: { balance: true, goldBalance: true },
    });
    log(`  → Final wallet: balance=₦${wallet?.balance ?? '?'} goldBalance=₦${wallet?.goldBalance ?? '?'}\n`);
  }

  log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Done${DRY_RUN ? ' (DRY RUN — no writes made)' : ''}

  WalletTransaction rows deleted : ${totalTxDeleted}
  ActivityWallet rows deleted    : ${totalActDeleted}
  Reward rows deleted            : ${totalRewardDeleted}
  Total balance reversed         : ₦${totalBalanceReversed.toFixed(3)}
  Winners re-credited (correct)  : ${totalWinnersReCredited}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch((e) => { console.error(e); process.exit(1); });
