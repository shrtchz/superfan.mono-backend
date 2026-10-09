const { Pool } = require('pg');

const url = 'postgresql://neondb_owner:npg_mct1L3EGhNjO@ep-wispy-breeze-atpun0yq-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function check() {
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const u5 = await pool.query('SELECT id, "userId", amount, description, trx_ref, "createdAt" FROM "WalletTransaction" WHERE "userId" = 5 ORDER BY id DESC LIMIT 10;');
  console.log('User 5 records in ep-wispy-breeze:', JSON.stringify(u5.rows, null, 2));

  const wallet = await pool.query('SELECT * FROM "Wallet" WHERE "userId" = 5;');
  console.log('User 5 wallet:', JSON.stringify(wallet.rows, null, 2));

  const attempts = await pool.query('SELECT * FROM "live_quiz_attempts" WHERE "userId" = \'5\';');
  console.log('User 5 live quiz attempts:', JSON.stringify(attempts.rows, null, 2));

  await pool.end();
}

check().catch(console.error);
