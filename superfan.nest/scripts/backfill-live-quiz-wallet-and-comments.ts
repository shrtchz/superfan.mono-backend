/**
 * backfill-live-quiz-wallet-and-comments.ts
 *
 * Fixes two things for past live quiz completions:
 *
 *  A. WALLET CREDIT — Winners who never got their prize credited:
 *     Finds all liveQuizAttempt rows where isWinner=true, earning>0, isCompleted=true
 *     and no `live_quiz_winner:userId:quizId` reward exists yet, then credits
 *     the Gold wallet with the raw Naira earning (no points conversion).
 *
 *  B. COMMENT TIMESTAMPS — Quiz-answer comments have createdAt = time of submission
 *     but should show the quiz finish time (completedAt on the attempt).
 *     We find the comment precisely using:
 *       - userId + streamId from ongoingLiveQuiz
 *       - answer text from ongoingLiveQuiz.answers[].selectedAnswer (+ label formatting)
 *       - submittedAt from ongoingLiveQuiz.answers[] as the narrow time window
 *     Then update createdAt → liveQuizAttempt.completedAt (= quiz finish time).
 *
 * Usage (from superfan.mono-backend/superfan.nest directory):
 *   DRY_RUN=true  npx ts-node -r tsconfig-paths/register scripts/backfill-live-quiz-wallet-and-comments.ts
 *   DRY_RUN=false npx ts-node -r tsconfig-paths/register scripts/backfill-live-quiz-wallet-and-comments.ts
 *
 * Safe to re-run — all operations are idempotent.
 */

import axios from 'axios';
import { prisma } from '../src/prisma/prisma';

const DRY_RUN = process.env.DRY_RUN !== 'false'; // defaults to DRY_RUN for safety
const GO_API_BASE = (
  process.env.GO_ENDPOINT ||
  process.env.NEXT_PUBLIC_GO_SERVICE_URL ||
  'http://localhost:8080'
).replace(/\/+$/, '');

// ─────────────────────────────────────────────────────────────────────────────

interface QuizMeta {
  quizFinishDate: Date | null;
  options: string[];
}

const metaCache = new Map<string, QuizMeta>();

async function getLiveQuizMeta(quizId: string): Promise<QuizMeta> {
  if (metaCache.has(quizId)) return metaCache.get(quizId)!;
  try {
    const res = await axios.get(`${GO_API_BASE}/v2/quiz/live/${quizId}`, { timeout: 8000 });
    const d = res.data?.data ?? res.data ?? {};
    const raw = d.quizFinishDate ?? d.finish_date ?? d.finishDate ?? null;
    const options: string[] = Array.isArray(d.options) ? d.options.map(String) : [];
    const meta: QuizMeta = {
      quizFinishDate: raw ? new Date(raw) : null,
      options,
    };
    metaCache.set(quizId, meta);
    return meta;
  } catch {
    const meta: QuizMeta = { quizFinishDate: null, options: [] };
    metaCache.set(quizId, meta);
    return meta;
  }
}

function normalizeText(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Build all the label variants the frontend could have posted as the comment text.
// The frontend posts something like "A. Option Text" or just "Option Text".
function buildAnswerLabels(selectedAnswer: string, options: string[]): string[] {
  const labels: string[] = [selectedAnswer];
  const idx = options.findIndex(
    (o) => normalizeText(o) === normalizeText(selectedAnswer),
  );
  if (idx >= 0) {
    const letter = String.fromCharCode(65 + idx); // A, B, C, D…
    labels.push(`${letter}. ${options[idx]}`);
    labels.push(`${letter}. ${selectedAnswer}`);
    labels.push(`${letter}) ${selectedAnswer}`);
    labels.push(`${letter}: ${selectedAnswer}`);
  }
  return labels;
}

async function creditGoldWallet(
  userId: number,
  amountNaira: number,
  quizFinishDate: Date,
) {
  await prisma.wallet.update({
    where: { userId },
    data: {
      balance: { increment: amountNaira },
      goldBalance: { increment: amountNaira },
    },
  });

  await (prisma.walletTransaction as any).create({
    data: {
      user: { connect: { id: userId } },
      amount: amountNaira,
      type: 'credit',
      currency: 'NGN',
      status: 'SUCCESS',
      description: 'Live Quiz Prize',
      account_type: 'Gold',
      trx_ref: `lqbf_${userId}_${Date.now()}`,
      createdAt: quizFinishDate,
    },
  });

  await prisma.activityWallet.create({
    data: {
      user: { connect: { id: userId } },
      type: 'credit',
      title: 'Live Quiz Prize',
      description: 'Live Quiz Prize',
      amount: amountNaira,
      currency: 'NGN',
      status: 'SUCCESS',
      createdAt: quizFinishDate,
    },
  });
}

async function main() {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Live Quiz Wallet + Comment Timestamp Backfill
  Mode : ${DRY_RUN ? 'DRY RUN (no writes)' : '✏️  WRITE'}
  Go   : ${GO_API_BASE}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  // Load all completed winner attempts
  const attempts = await prisma.liveQuizAttempt.findMany({
    where: { isCompleted: true },
    include: { ongoingLiveQuiz: true },
    orderBy: { completedAt: 'asc' },
  });

  console.log(`Found ${attempts.length} completed liveQuizAttempt rows\n`);

  let walletCredited = 0;
  let walletSkipped = 0;
  let commentFixed = 0;
  let commentNotFound = 0;

  for (const attempt of attempts) {
    const userId = Number(attempt.userId);
    const quizId = attempt.quizId;
    const earning = Number(attempt.earning ?? 0);
    const isWinner = attempt.isWinner;

    // Resolve quiz finish time from best available source:
    //  1. attempt.completedAt      (set by authenticateFinishedSubmissionsForQuiz)
    //  2. Go API quizFinishDate    (returned by /v2/quiz/live/:id)
    //  3. ongoingLiveQuiz.updatedAt (proxy — updated when session was graded)
    //  4. null                     (wallet credit still happens with now() fallback)
    let quizFinishDate: Date | null = attempt.completedAt ?? null;
    const meta = await getLiveQuizMeta(quizId);
    if (!quizFinishDate && meta.quizFinishDate) quizFinishDate = meta.quizFinishDate;
    if (!quizFinishDate && attempt.ongoingLiveQuiz?.updatedAt) quizFinishDate = new Date(attempt.ongoingLiveQuiz.updatedAt);

    // ── A. Wallet credit for winners ────────────────────────────────────────
    if (isWinner && earning > 0) {
      const rewardRef = `live_quiz_winner:${userId}:${quizId}`;
      const existing = await prisma.reward.findFirst({
        where: { userId, type: 'live_quiz_winner', reference: rewardRef },
      });

      if (existing) {
        walletSkipped++;
      } else {
        const ts = quizFinishDate ?? new Date();
        console.log(
          `  💰 WINNER userId=${userId} quizId=${quizId} ₦${earning} @ ${ts.toISOString()}`,
        );
        if (!DRY_RUN) {
          // Create reward record (idempotency anchor)
          await prisma.reward.create({
            data: {
              userId,
              amount: earning,
              currency: 'NGN',
              type: 'live_quiz_winner',
              status: 'PAID_OUT',
              reference: rewardRef,
              createdAt: ts,
            },
          });
          // Credit Gold wallet
          await creditGoldWallet(userId, earning, ts);
        }
        walletCredited++;
      }
    }

    // ── B. Fix comment timestamp ─────────────────────────────────────────────
    // For comment timestamps: prefer quizFinishDate, fall back to the answer's
    // own submittedAt (= the real moment the user selected their answer).
    const session = attempt.ongoingLiveQuiz;
    if (!session?.streamId) continue;

    const answers: any[] = (session.answers as any[]) ?? [];
    const answerEntry = answers.find((a: any) => String(a?.quizId) === quizId);
    if (!answerEntry?.selectedAnswer) continue;

    const selectedAnswer = String(answerEntry.selectedAnswer);
    const answerSubmittedAt: Date | null = answerEntry.submittedAt
      ? new Date(answerEntry.submittedAt)
      : null;

    // The timestamp we'll stamp the comment with: quiz end time if available,
    // otherwise the moment the user submitted their answer.
    const commentTs = quizFinishDate ?? answerSubmittedAt;
    if (!commentTs) {
      console.log(
        `  ⚠️  No timestamp available for quizId=${quizId} userId=${userId} — skipping comment fix`,
      );
      commentNotFound++;
      continue;
    }

    // Build all label variants the frontend may have posted
    const labels = buildAnswerLabels(selectedAnswer, meta.options);
    const labelsNorm = labels.map(normalizeText);

    // Search ±2h around the answer submission time
    const windowStart = new Date(commentTs.getTime() - 2 * 60 * 60 * 1000);
    const windowEnd   = new Date(commentTs.getTime() + 2 * 60 * 60 * 1000);

    const candidates = await prisma.streamComment.findMany({
      where: {
        userId,
        streamId: session.streamId,
        isDeleted: false,
        createdAt: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, message: true, createdAt: true },
    });

    const matched = candidates.filter((c) =>
      labelsNorm.some((label) => normalizeText(c.message) === label),
    );

    if (matched.length === 0) {
      console.log(
        `  ⚠️  No comment found userId=${userId} streamId=${session.streamId} quizId=${quizId} answer="${selectedAnswer}"`,
      );
      commentNotFound++;
      continue;
    }

    for (const comment of matched) {
      const alreadyCorrect = Math.abs(comment.createdAt.getTime() - commentTs.getTime()) < 1000;
      if (alreadyCorrect) continue;

      console.log(
        `  ✅ Comment #${comment.id} userId=${userId} "${comment.message}"` +
        `\n     ${comment.createdAt.toISOString()} → ${commentTs.toISOString()}`,
      );

      if (!DRY_RUN) {
        await prisma.streamComment.update({
          where: { id: comment.id },
          data: { createdAt: commentTs },
        });
      }
      commentFixed++;
    }
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Done${DRY_RUN ? ' (DRY RUN — no writes made)' : ''}

  Wallet credited (winners)    : ${walletCredited}
  Wallet skipped (already paid): ${walletSkipped}
  Comment timestamps fixed     : ${commentFixed}
  Comments not found/skipped   : ${commentNotFound}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
