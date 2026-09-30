#!/usr/bin/env node
/*
  One-off script to convert numeric-second `quizTime` strings to MM:SS
  Usage: from `superfan.mono-backend/superfan.nest` run:
    node ./scripts/convert-quiztime-to-mmss.js
  Ensure `DATABASE_URL` is set in environment or .env is present.
*/
const { PrismaClient } = require('@prisma/client');

function formatSecondsToMMSS(value) {
  if (value == null) return '0:00';
  const raw = String(value).trim();
  if (!raw) return '0:00';
  if (raw.includes(':')) return raw;
  const secs = Number(raw);
  if (!Number.isFinite(secs) || secs < 0) return raw;
  const minutes = Math.floor(secs / 60);
  const seconds = secs % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('Searching for ongoingQuiz entries with numeric quizTime...');
    const ongoing = await prisma.ongoingQuiz.findMany({
      where: { quizTime: { not: null } },
      select: { id: true, quizTime: true },
    });

    let updatedCount = 0;
    for (const row of ongoing) {
      const q = row.quizTime;
      if (q == null) continue;
      const raw = String(q).trim();
      if (/^\d+$/.test(raw)) {
        const mmss = formatSecondsToMMSS(raw);
        await prisma.ongoingQuiz.update({ where: { id: row.id }, data: { quizTime: mmss } });
        console.log(`Updated ongoingQuiz ${row.id}: ${raw} -> ${mmss}`);
        updatedCount++;
      }
    }

    console.log(`Updated ${updatedCount} ongoingQuiz rows.`);

    // Update QuizLeaderboard entries if present
    // Try updating QuizLeaderboard if present in the Prisma client
    try {
      if (prisma.quizLeaderboard) {
        console.log('Searching for QuizLeaderboard entries with numeric quizTime...');
        const rows = await prisma.quizLeaderboard.findMany({ where: { quizTime: { not: null } }, select: { id: true, quizTime: true } });
        let lbUpdated = 0;
        for (const r of rows) {
          const raw = String(r.quizTime ?? '').trim();
          if (/^\d+$/.test(raw)) {
            const mmss = formatSecondsToMMSS(raw);
            await prisma.quizLeaderboard.update({ where: { id: r.id }, data: { quizTime: mmss } });
            console.log(`Updated QuizLeaderboard ${r.id}: ${raw} -> ${mmss}`);
            lbUpdated++;
          }
        }
        console.log(`Updated ${lbUpdated} QuizLeaderboard rows.`);
      }
    } catch (err) {
      console.log('QuizLeaderboard model not available or update failed; skipping leaderboard updates.', err.message || err);
    }

    console.log('Done.');
  } catch (err) {
    console.error('Error during conversion:', err);
    process.exitCode = 1;
  } finally {
    try { await prisma.$disconnect(); } catch (e) {}
  }
}

main();
