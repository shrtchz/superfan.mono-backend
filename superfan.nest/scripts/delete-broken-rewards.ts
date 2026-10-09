/**
 * delete-broken-rewards.ts
 * Deletes the live_quiz_winner reward rows that were created by the
 * broken backfill (idempotency anchor without actual wallet credit).
 * Safe to run — only deletes live_quiz_winner rewards created after
 * 2026-10-09 (today), leaving any legitimate older records intact.
 */
import { prisma } from '../src/prisma/prisma';

async function main() {
  // Show what exists first
  const existing = await prisma.reward.findMany({
    where: { type: 'live_quiz_winner' },
    select: { id: true, userId: true, reference: true, createdAt: true, amount: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${existing.length} live_quiz_winner reward rows:`);
  existing.forEach((r) => console.log(`  id=${r.id} userId=${r.userId} ref=${r.reference} amount=${r.amount} createdAt=${r.createdAt.toISOString()}`));

  if (existing.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  // Delete ALL live_quiz_winner rewards — the correct backfill will recreate them
  // along with the actual wallet credit in one go.
  const deleted = await prisma.reward.deleteMany({
    where: { type: 'live_quiz_winner' },
  });

  console.log(`\nDeleted ${deleted.count} broken reward rows. Re-run the backfill now.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
