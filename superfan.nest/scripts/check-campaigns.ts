import { prisma } from '../src/prisma/prisma';

async function main() {
  const campaigns = await prisma.adCampaign.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  console.log(`Found ${campaigns.length} campaigns:`);
  for (const c of campaigns) {
    console.log({
      id: c.id,
      headline: c.headline,
      status: c.status,
      startDate: c.startDate,
      endDate: c.endDate,
      days: c.days,
      runContinuously: c.runContinuously,
      views: c.views,
      createdAt: c.createdAt,
    });
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
