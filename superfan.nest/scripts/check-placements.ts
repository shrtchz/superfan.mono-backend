import { prisma } from '../src/prisma/prisma';

async function main() {
  const placements = await prisma.adPlacement.findMany();
  console.log(`Found ${placements.length} placements:`);
  for (const p of placements) {
    console.log(p);
  }

  const events = await prisma.adEvent.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
  });
  console.log(`Found ${events.length} recent events:`);
  for (const e of events) {
    console.log(e);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
