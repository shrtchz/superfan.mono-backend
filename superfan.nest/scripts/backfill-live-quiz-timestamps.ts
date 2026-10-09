/**
 * backfill-live-quiz-timestamps.ts
 *
 * One-shot migration: fix createdAt timestamps on past live quiz records so
 * they reflect the quiz finish time rather than the moment the user submitted.
 *
 * Corrects:
 *   1. StreamComment rows whose message matches the user's selected answer
 *      for a quiz — timestamped to quizFinishDate
 *   2. WalletTransaction rows of type 'credit' with description 'Live Quiz Prize'
 *      — timestamped to quizFinishDate
 *   3. ActivityWallet rows with title 'Live Quiz Prize'
 *      — timestamped to quizFinishDate
 *   4. Reward rows of type 'live_quiz_winner'
 *      — timestamped to quizFinishDate
 *
 * Usage (from superfan.mono-backend/superfan.nest directory):
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-live-quiz-timestamps.ts
 *
 * Safe to re-run: rows already at the correct timestamp are skipped.
 */

import axios from 'axios';
import { prisma } from '../src/prisma/prisma';

// ── Config ────────────────────────────────────────────────────────────────────
const GO_API_BASE = process.env.GO_ENDPOINT || process.env.NEXT_PUBLIC_GO_SERVICE_URL || 'http://localhost:8080';
const DRY_RUN = process.env.DRY_RUN === 'true'; // set DRY_RUN=true to preview without writing
// ─────────────────────────────────────────────────────────────────────────────

interface QuizMeta {
  quizFinishDate: Date | null;
  answer: string;
  options: string[];
}

const metaCache = new Map<string, QuizMeta>();

async function getLiveQuizMeta(quizId: string): Promise<QuizMeta> {
  if (metaCache.has(quizId)) return metaCache.get(quizId)!;

  try {
    const res = await axios.get(`${GO_API_BASE}/v2/quiz/live/${quizId}`, {
      timeout: 8000,
    });
    const d = res.data?.data ?? res.data ?? {};
    const raw = d.quizFinishDate ?? d.finish_date ?? d.finishDate ?? null;
    const meta: QuizMeta = {
      quizFinishDate: raw ? new Date(raw) : null,
      answer: String(d.answer ?? d.correctAnswer ?? '').trim(),
      options: Array.isArray(d.options) ? d.options.map(String) : [],
    };
    metaCache.set(quizId, meta);
    return meta;
  } catch {
    const meta: QuizMeta = { quizFinishDate: null, answer: '', options: [] };
    metaCache.set(quizId, meta);
    return meta;
  }
}

function normalizeText(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function main() {
  console.log(`\n🔧  Live Quiz Timestamp Backfill — ${DRY_RUN ? 'DRY RUN' : 'WRITE MODE'}\n`);

  // ── 1. Load all completed live quiz attempts (winners + non-winners) ─────
  const attempts = await prisma.liveQuizAttempt.findMany({
    where: { isCompleted: true },
    select: {
      userId: true,
      quizId: true,
      earning: true,
      isWinner: true,
      completedAt: true,
    },
  });

  console.log(`Found ${attempts.length} completed liveQuizAttempt rows`);

  let commentFixed = 0;
  let walletTxFixed = 0;
  let activityFixed = 0;
  let rewardFixed = 0;
  let skipped = 0;

  for (const attempt of attempts) {
    const meta = await getLiveQuizMeta(attempt.quizId);
    const finishDate = meta.quizFinishDate;

    if (!finishDate) {
      skipped++;
      continue;
    }

    const userId = Number(attempt.userId);

    // ── 2. Fix StreamComment ─────────────────────────────────────────────────
    // Find comments by this user on any stream whose message matches one of
    // the quiz options (we can't link comment→quiz directly, so we match on
    // option text proximity to finishDate ± 24 h window to avoid false hits).
    const windowStart = new Date(finishDate.getTime() - 24 * 60 * 60 * 1000);
    const windowEnd   = new Date(finishDate.getTime() + 24 * 60 * 60 * 1000);

    const quizOptionTexts = meta.options.map(normalizeText).filter(Boolean);

    if (quizOptionTexts.length > 0) {
      // Find comments by this user within the time window
      const comments = await (prisma.streamComment as any).findMany({
        where: {
          userId,
          isDeleted: false,
          createdAt: { gte: windowStart, lte: windowEnd },
        },
        select: { id: true, message: true, createdAt: true },
      });

      for (const comment of comments) {
        const msgNorm = normalizeText(comment.message);
        const isAnswerComment = quizOptionTexts.some((opt) =>
          msgNorm.includes(opt) || opt.includes(msgNorm),
        );
        if (!isAnswerComment) continue;

        const alreadyCorrect =
          Math.abs(comment.createdAt.getTime() - finishDate.getTime()) < 1000;
        if (alreadyCorrect) continue;

        if (!DRY_RUN) {
          await (prisma.streamComment as any).update({
            where: { id: comment.id },
            data: { createdAt: finishDate },
          });
        }
        console.log(
          `  ✅ StreamComment #${comment.id} userId=${userId} quizId=${attempt.quizId}` +
          `  ${comment.createdAt.toISOString()} → ${finishDate.toISOString()}`,
        );
        commentFixed++;
      }
    }

    // Only winners get wallet records
    if (!attempt.isWinner || !attempt.earning || Number(attempt.earning) <= 0) continue;

    const rewardRef = `live_quiz_winner:${userId}:${attempt.quizId}`;

    // ── 3. Fix Reward row ────────────────────────────────────────────────────
    const reward = await prisma.reward.findFirst({
      where: { userId, type: 'live_quiz_winner', reference: rewardRef },
      select: { id: true, createdAt: true },
    });

    if (reward) {
      const alreadyCorrect =
        Math.abs(reward.createdAt.getTime() - finishDate.getTime()) < 1000;
      if (!alreadyCorrect) {
        if (!DRY_RUN) {
          await prisma.reward.update({
            where: { id: reward.id },
            data: { createdAt: finishDate },
          });
        }
        console.log(
          `  ✅ Reward #${reward.id} userId=${userId} quizId=${attempt.quizId}` +
          `  ${reward.createdAt.toISOString()} → ${finishDate.toISOString()}`,
        );
        rewardFixed++;
      }
    }

    // ── 4. Fix WalletTransaction ─────────────────────────────────────────────
    const txWindow = { gte: windowStart, lte: windowEnd };
    const walletTxs = await (prisma.walletTransaction as any).findMany({
      where: {
        userId,
        type: 'credit',
        description: 'Live Quiz Prize',
        createdAt: txWindow,
      },
      select: { id: true, createdAt: true },
    });

    for (const tx of walletTxs) {
      const alreadyCorrect =
        Math.abs(tx.createdAt.getTime() - finishDate.getTime()) < 1000;
      if (alreadyCorrect) continue;

      if (!DRY_RUN) {
        await (prisma.walletTransaction as any).update({
          where: { id: tx.id },
          data: { createdAt: finishDate },
        });
      }
      console.log(
        `  ✅ WalletTransaction #${tx.id} userId=${userId} quizId=${attempt.quizId}` +
        `  ${tx.createdAt.toISOString()} → ${finishDate.toISOString()}`,
      );
      walletTxFixed++;
    }

    // ── 5. Fix ActivityWallet ────────────────────────────────────────────────
    const activities = await prisma.activityWallet.findMany({
      where: {
        userId,
        title: 'Live Quiz Prize',
        createdAt: txWindow,
      },
      select: { id: true, createdAt: true },
    });

    for (const act of activities) {
      const alreadyCorrect =
        Math.abs(act.createdAt.getTime() - finishDate.getTime()) < 1000;
      if (alreadyCorrect) continue;

      if (!DRY_RUN) {
        await prisma.activityWallet.update({
          where: { id: act.id },
          data: { createdAt: finishDate },
        });
      }
      console.log(
        `  ✅ ActivityWallet #${act.id} userId=${userId} quizId=${attempt.quizId}` +
        `  ${act.createdAt.toISOString()} → ${finishDate.toISOString()}`,
      );
      activityFixed++;
    }
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Backfill complete${DRY_RUN ? ' (DRY RUN — no writes)' : ''}
  StreamComment rows fixed : ${commentFixed}
  WalletTransaction fixed  : ${walletTxFixed}
  ActivityWallet fixed     : ${activityFixed}
  Reward rows fixed        : ${rewardFixed}
  Skipped (no finish date) : ${skipped}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
}

main().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
