/**
 * Production clean-slate backfill for live quiz wallet + comment timestamps.
 *
 * For quiz 6ac7b85d5d2b24107ab2e57f, userId=5:
 *  - Delete WalletTransaction rows 120-124
 *  - Delete corresponding Reward rows (type=live_quiz_reward, userId=5)
 *  - Delete corresponding ActivityWallet rows (117-121 for userId=5)
 *  - Recompute wallet goldBalance by reversing the dirty credits
 *  - Insert one correct WalletTransaction (₦600, trx_ref=live_quiz_reward:quizId:userId)
 *  - Insert one correct Reward row
 *  - Insert one correct ActivityWallet row
 *  - Stamp all new rows + comment at the real answer time (submittedAt from ongoing_live_quiz)
 *
 * Also handles ALL other winner attempts that have no wallet credit yet
 * (ids 1-4 for QUIZ_YORUBA_001, completedAt=null — will be skipped unless they have LQ_ rows).
 *
 * DRY_RUN=true (default) — just prints what it would do.
 * DRY_RUN=false — actually applies.
 */

import { prisma } from '../src/prisma/prisma';

const DRY_RUN = process.env.DRY_RUN !== 'false';

interface OngoingLiveQuizAnswer {
  quizId: string;
  submittedAt: string;
  selectedAnswer: string;
}

async function main() {
  console.log(`\n🔍 Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : '⚠️  LIVE — applying changes to production'}\n`);

  // ─── 1. Find all dirty WalletTransaction rows ───────────────────────────────
  const dirtyTxs = await prisma.walletTransaction.findMany({
    where: {
      OR: [
        // Old non-idempotent Go scheduler format (duplicates)
        { trx_ref: { startsWith: 'LQ_' } },
        // Old backfill format
        { trx_ref: { startsWith: 'lqbf_' } },
        { description: 'Live Quiz Prize' },
        // Wrong-amount idempotent entries (₦0.6 instead of ₦600) — keep live_quiz_reward: ONLY if amount is wrong
        // We detect these by checking if description contains the wrong amount pattern
        {
          AND: [
            { trx_ref: { startsWith: 'live_quiz_reward:' } },
            { amount: { lt: 1 } }, // sub-₦1 = definitely wrong (should be ₦600+)
          ],
        },
      ],
    },
    orderBy: { id: 'asc' },
  });

  console.log(`Found ${dirtyTxs.length} dirty WalletTransaction rows:`);
  dirtyTxs.forEach(tx => {
    console.log(`  id=${tx.id} userId=${tx.userId} amount=${tx.amount} trx_ref=${tx.trx_ref}`);
  });

  if (dirtyTxs.length === 0) {
    console.log('Nothing to clean. Exiting.');
    return;
  }

  // ─── 2. Group by userId ──────────────────────────────────────────────────────
  const byUser = new Map<number, typeof dirtyTxs>();
  for (const tx of dirtyTxs) {
    const list = byUser.get(tx.userId) ?? [];
    list.push(tx);
    byUser.set(tx.userId, list);
  }

  // ─── 3. Process each user ────────────────────────────────────────────────────
  for (const [userId, txs] of byUser.entries()) {
    console.log(`\n─── userId=${userId} (${txs.length} dirty txs) ───`);

    // Extract quizId from trx_ref
    const quizIdSet = new Set<string>();
    for (const tx of txs) {
      const ref = tx.trx_ref ?? '';
      if (ref.startsWith('LQ_')) {
        // LQ_<quizId>_<snowflake>
        const parts = ref.split('_');
        if (parts.length >= 3) quizIdSet.add(parts[1]);
      } else if (ref.startsWith('live_quiz_reward:')) {
        // live_quiz_reward:<quizId>:<userId>
        const parts = ref.split(':');
        if (parts.length >= 2) quizIdSet.add(parts[1]);
      }
    }

    console.log(`  Detected quizIds: ${[...quizIdSet].join(', ')}`);

    for (const quizId of quizIdSet) {
      // ── Look up live_quiz_attempt ──
      const attempt = await (prisma as any).$queryRaw<any[]>`
        SELECT * FROM live_quiz_attempts
        WHERE "userId" = ${String(userId)} AND "quizId" = ${quizId}
        LIMIT 1;
      `;
      if (!attempt || attempt.length === 0) {
        console.log(`  ⚠️  No live_quiz_attempt found for userId=${userId} quizId=${quizId} — skipping`);
        continue;
      }
      const att = attempt[0];
      console.log(`  Attempt: isWinner=${att.isWinner} isCompleted=${att.isCompleted} earning=${att.earning} unitPrize=${att.unitPrize}`);

      if (!att.isWinner || !att.isCompleted) {
        console.log(`  ⚠️  Not a winner or not completed — skipping re-credit`);
      }

      // ── Get the real quiz END timestamp from ongoing_live_quiz.updatedAt ──
      const ongoing = await (prisma as any).$queryRaw<any[]>`
        SELECT * FROM ongoing_live_quiz WHERE id = ${att.ongoingLiveQuizId} LIMIT 1;
      `;
      // Use quiz end time = when the quiz was finalized (ongoing_live_quiz.updatedAt)
      // NOT the individual submittedAt, which is when the user answered mid-quiz
      let answerTs: Date = att.completedAt ?? att.updatedAt ?? new Date();
      if (ongoing && ongoing.length > 0) {
        const quizEndTime = ongoing[0].updatedAt;
        if (quizEndTime) {
          answerTs = new Date(quizEndTime);
          console.log(`  ✅ Quiz end timestamp from ongoing_live_quiz.updatedAt: ${answerTs.toISOString()}`);
        }
      }

      // ── Sum of dirty credits to reverse ──
      const quizTxs = txs.filter(tx => {
        const ref = tx.trx_ref ?? '';
        return ref.includes(quizId);
      });
      const totalDirty = quizTxs.reduce((sum, tx) => sum + Number(tx.amount), 0);
      const correctAmount = Number(att.unitPrize ?? att.earning);

      console.log(`  Dirty credits to remove: ₦${totalDirty} (${quizTxs.length} rows)`);
      console.log(`  Correct single credit: ₦${correctAmount} at ${answerTs.toISOString()}`);

      // ── Current wallet ──
      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      if (!wallet) {
        console.log(`  ⚠️  No wallet found for userId=${userId}`);
        continue;
      }
      console.log(`  Current goldBalance: ₦${wallet.goldBalance}, balance: ₦${wallet.balance}`);
      const newGoldBalance = Number(wallet.goldBalance) - totalDirty + correctAmount;
      const newBalance = Number(wallet.balance) - totalDirty + correctAmount;
      console.log(`  New goldBalance after fix: ₦${newGoldBalance.toFixed(3)}`);
      console.log(`  New balance after fix:     ₦${newBalance.toFixed(3)}`);

      // ── Dirty ActivityWallet rows ──
      const dirtyActivities = await prisma.activityWallet.findMany({
        where: {
          userId,
          OR: [
            { description: { contains: 'Live Quiz' } },
            { title: { contains: 'Live Quiz' } },
          ],
        },
        orderBy: { id: 'asc' },
      });
      console.log(`  ActivityWallet rows to delete: ${dirtyActivities.length} (ids: ${dirtyActivities.map(a => a.id).join(', ')})`);

      // ── Dirty Reward rows ──
      const dirtyRewards = await prisma.reward.findMany({
        where: {
          userId,
          type: { in: ['live_quiz_reward', 'live_quiz_winner', 'live_quiz_consolation', 'consolation'] },
        },
        orderBy: { id: 'asc' },
      });
      console.log(`  Reward rows to delete: ${dirtyRewards.length} (ids: ${dirtyRewards.map(r => r.id).join(', ')})`);

      // ── StreamComment to fix ──
      const commentsToFix = await prisma.streamComment.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });
      // Find comments that look like quiz answers (same stream, near the time of first LQ_ tx)
      const liveQuizComments = commentsToFix.filter(c => {
        // Heuristic: any comment that is NOT already at the correct time
        return c.createdAt.getTime() !== answerTs.getTime();
      });
      console.log(`  StreamComments to timestamp-fix: ${liveQuizComments.length} (ids: ${liveQuizComments.map(c => c.id).join(', ')})`);

      if (DRY_RUN) {
        console.log(`\n  [DRY RUN] Would:`);
        console.log(`    - Delete WalletTransaction ids: ${quizTxs.map(t => t.id).join(', ')}`);
        console.log(`    - Delete Reward ids: ${dirtyRewards.map(r => r.id).join(', ')}`);
        console.log(`    - Delete ActivityWallet ids: ${dirtyActivities.map(a => a.id).join(', ')}`);
        console.log(`    - Set Wallet.goldBalance = ${newGoldBalance.toFixed(3)}, balance = ${newBalance.toFixed(3)}`);
        console.log(`    - Create 1 WalletTransaction (₦${correctAmount}) trx_ref=live_quiz_reward:${quizId}:${userId} at ${answerTs.toISOString()}`);
        console.log(`    - Create 1 Reward (₦${correctAmount} live_quiz_reward) at ${answerTs.toISOString()}`);
        console.log(`    - Create 1 ActivityWallet at ${answerTs.toISOString()}`);
        console.log(`    - Update ${liveQuizComments.length} StreamComment createdAt → ${answerTs.toISOString()}`);
        continue;
      }

      // ──────────────────────────────────────────────────────────────────────────
      // APPLY CHANGES (DRY_RUN=false)
      // ──────────────────────────────────────────────────────────────────────────
      console.log(`\n  Applying changes...`);

      // 1. Delete dirty WalletTransaction rows
      if (quizTxs.length > 0) {
        await prisma.walletTransaction.deleteMany({ where: { id: { in: quizTxs.map(t => t.id) } } });
        console.log(`  ✅ Deleted ${quizTxs.length} WalletTransaction rows`);
      }

      // 2. Delete dirty Reward rows
      if (dirtyRewards.length > 0) {
        await prisma.reward.deleteMany({ where: { id: { in: dirtyRewards.map(r => r.id) } } });
        console.log(`  ✅ Deleted ${dirtyRewards.length} Reward rows`);
      }

      // 3. Delete dirty ActivityWallet rows
      if (dirtyActivities.length > 0) {
        await prisma.activityWallet.deleteMany({ where: { id: { in: dirtyActivities.map(a => a.id) } } });
        console.log(`  ✅ Deleted ${dirtyActivities.length} ActivityWallet rows`);
      }

      // 4. Fix wallet balance
      await prisma.wallet.update({
        where: { userId },
        data: { goldBalance: newGoldBalance, balance: newBalance },
      });
      console.log(`  ✅ Wallet updated: goldBalance=₦${newGoldBalance.toFixed(3)}, balance=₦${newBalance.toFixed(3)}`);

      if (att.isWinner && att.isCompleted) {
        const desc = `You earned ₦${correctAmount} from Live Quiz reward`;

        // 5. Create 1 correct WalletTransaction
        await prisma.walletTransaction.create({
          data: {
            userId,
            amount: correctAmount,
            type: 'credit',
            currency: 'NGN',
            account_type: 'Gold',
            status: 'Completed',
            transactionType: 'Reward',
            description: desc,
            trx_ref: `live_quiz_reward:${quizId}:${userId}`,
            createdAt: answerTs,
          },
        });
        console.log(`  ✅ Created WalletTransaction ₦${correctAmount} at ${answerTs.toISOString()}`);

        // 6. Create 1 correct Reward
        await prisma.reward.create({
          data: {
            userId,
            amount: correctAmount,
            currency: 'NGN',
            type: 'live_quiz_reward',
            status: 'PAID_OUT',
            createdAt: answerTs,
          },
        });
        console.log(`  ✅ Created Reward ₦${correctAmount} at ${answerTs.toISOString()}`);

        // 7. Create 1 correct ActivityWallet (user connect — userId is a relation field)
        await prisma.activityWallet.create({
          data: {
            user: { connect: { id: userId } },
            title: `₦${correctAmount} has been added to your wallet`,
            description: `You earned ₦${correctAmount} from Live Quiz`,
            amount: correctAmount,
            currency: 'NGN',
            type: 'credit',
            status: 'SUCCESS',
            createdAt: answerTs,
          },
        });
        console.log(`  ✅ Created ActivityWallet ₦${correctAmount} at ${answerTs.toISOString()}`);
      }

      // 8. Fix StreamComment timestamps
      if (liveQuizComments.length > 0) {
        await prisma.streamComment.updateMany({
          where: { id: { in: liveQuizComments.map(c => c.id) } },
          data: { createdAt: answerTs },
        });
        console.log(`  ✅ Updated ${liveQuizComments.length} StreamComment(s) createdAt → ${answerTs.toISOString()}`);
      }
    }
  }

  console.log('\n✅ Done.\n');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
