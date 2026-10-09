import { prisma } from '../src/prisma/prisma';

const userIds = [1, 2, 4, 5, 6, 7];

async function main() {
  for (const userId of userIds) {
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      select: { balance: true, goldBalance: true },
    });

    const txs = await prisma.walletTransaction.findMany({
      where: { userId, description: 'Live Quiz Prize' },
      select: { id: true, amount: true, account_type: true, createdAt: true, status: true },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    const activities = await prisma.activityWallet.findMany({
      where: { userId, title: 'Live Quiz Prize' },
      select: { id: true, amount: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    console.log(`\n── userId=${userId} ──`);
    console.log(`  wallet: balance=₦${wallet?.balance ?? 'N/A'} goldBalance=₦${wallet?.goldBalance ?? 'N/A'}`);
    console.log(`  walletTransactions (Live Quiz Prize): ${txs.length}`);
    txs.forEach((t) => console.log(`    ₦${t.amount} ${t.account_type} ${t.status} @ ${t.createdAt.toISOString()}`));
    console.log(`  activityWallet (Live Quiz Prize): ${activities.length}`);
    activities.forEach((a) => console.log(`    ₦${a.amount} ${a.status} @ ${a.createdAt.toISOString()}`));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
