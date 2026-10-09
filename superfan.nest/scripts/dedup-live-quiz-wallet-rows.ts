/**
 * dedup-live-quiz-wallet-rows.ts
 * Removes the duplicate WalletTransaction and ActivityWallet rows left by the
 * broken first backfill run, and corrects the wallet balance (subtracts the
 * extra ₦500 that was double-credited to each winner).
 */
import { prisma } from '../src/prisma/prisma';

const userIds = [1, 2, 4, 5, 6, 7];
const PRIZE = 500;

async function main() {
  for (const userId of userIds) {
    // ── WalletTransaction dedup ─────────────────────────────────────────────
    const txs = await prisma.walletTransaction.findMany({
      where: { userId, description: 'Live Quiz Prize' },
      orderBy: { id: 'asc' },
      select: { id: true, amount: true },
    });

    if (txs.length > 1) {
      const toDeleteTx = txs.slice(1).map((t) => t.id);
      const dupAmount = txs.slice(1).reduce((s, t) => s + t.amount, 0);
      await prisma.walletTransaction.deleteMany({ where: { id: { in: toDeleteTx } } });
      // Reverse the duplicate balance increments
      await prisma.wallet.update({
        where: { userId },
        data: {
          balance:     { decrement: dupAmount },
          goldBalance: { decrement: dupAmount },
        },
      });
      console.log(`userId=${userId}: removed ${toDeleteTx.length} duplicate walletTransaction(s), reversed ₦${dupAmount}`);
    }

    // ── ActivityWallet dedup ────────────────────────────────────────────────
    const activities = await prisma.activityWallet.findMany({
      where: { userId, title: 'Live Quiz Prize' },
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    if (activities.length > 1) {
      const toDeleteAct = activities.slice(1).map((a) => a.id);
      await prisma.activityWallet.deleteMany({ where: { id: { in: toDeleteAct } } });
      console.log(`userId=${userId}: removed ${toDeleteAct.length} duplicate activityWallet row(s)`);
    }

    // ── Verify final state ──────────────────────────────────────────────────
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      select: { balance: true, goldBalance: true },
    });
    console.log(`  → wallet: balance=₦${wallet?.balance} goldBalance=₦${wallet?.goldBalance}\n`);
  }

  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
