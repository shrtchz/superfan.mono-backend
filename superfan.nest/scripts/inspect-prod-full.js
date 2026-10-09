const { Pool } = require('pg');
require('dotenv').config();

const PROD_URL = 'postgresql://neondb_owner:npg_5XsMBJDpZ2jz@ep-silent-violet-aylk8d6w-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

async function run() {
  const pool = new Pool({ connectionString: PROD_URL, ssl: { rejectUnauthorized: false } });

  // Check comment table name
  const tables = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename ILIKE '%comment%';`);
  console.log('Comment-related tables:', tables.rows);

  // Get all live quiz attempts to know what we're dealing with
  const allAttempts = await pool.query(`SELECT id, "userId", "quizId", earning, "isWinner", "isCompleted", "completedAt" FROM "live_quiz_attempts" WHERE "isWinner" = true AND "isCompleted" = true ORDER BY id;`);
  console.log('\nAll winner attempts:', JSON.stringify(allAttempts.rows, null, 2));

  // Get all live-quiz wallet txs across all users
  const allLiveTxs = await pool.query(`
    SELECT id, "userId", amount, trx_ref, description, "createdAt"
    FROM "WalletTransaction"
    WHERE trx_ref LIKE 'LQ_%'
       OR trx_ref LIKE 'live_quiz_%'
       OR trx_ref LIKE 'lqbf_%'
       OR description = 'Live Quiz Prize'
       OR (description LIKE 'You earned%' AND description LIKE '%Live Quiz%')
    ORDER BY "userId", id;
  `);
  console.log('\nAll live-quiz wallet txs across all users:', JSON.stringify(allLiveTxs.rows, null, 2));

  // Reward rows
  const allRewards = await pool.query(`
    SELECT id, "userId", amount, type, reference, status FROM "Reward"
    WHERE type IN ('live_quiz_winner','live_quiz_consolation','live_quiz_reward','consolation')
    ORDER BY "userId", id;
  `);
  console.log('\nLive quiz reward rows:', JSON.stringify(allRewards.rows, null, 2));

  // ActivityWallet live quiz rows
  const allActs = await pool.query(`
    SELECT id, "userId", title, description, amount, "createdAt" FROM "ActivityWallet"
    WHERE title ILIKE '%live quiz%' OR description ILIKE '%live quiz%'
    ORDER BY "userId", id;
  `);
  console.log('\nActivityWallet live quiz rows:', JSON.stringify(allActs.rows, null, 2));

  await pool.end();
}

run().catch(console.error);
