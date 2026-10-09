const { Pool } = require('pg');
require('dotenv').config();

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  
  const total = await pool.query('SELECT count(*) FROM "WalletTransaction";');
  console.log('Total WalletTransaction rows:', total.rows[0].count);

  const u5 = await pool.query(`
    SELECT id, "userId", amount, trx_ref, description, "createdAt"
    FROM "WalletTransaction"
    WHERE "userId" = 5
    ORDER BY id DESC
    LIMIT 10;
  `);
  console.log('User 5 last 10 txs:', JSON.stringify(u5.rows, null, 2));

  const liveQuizTxs = await pool.query(`
    SELECT id, "userId", amount, trx_ref, description
    FROM "WalletTransaction"
    WHERE trx_ref LIKE 'LQ_%'
       OR trx_ref LIKE 'live_quiz_%'
       OR trx_ref LIKE 'lqbf_%'
       OR description = 'Live Quiz Prize'
       OR (description LIKE 'You earned%' AND description LIKE '%Live Quiz%')
    ORDER BY id DESC;
  `);
  console.log('\nAll live-quiz wallet rows:', JSON.stringify(liveQuizTxs.rows, null, 2));

  const attempts = await pool.query(`SELECT * FROM "live_quiz_attempts" WHERE "userId" = '5';`);
  console.log('\nUser 5 live quiz attempts:', JSON.stringify(attempts.rows, null, 2));

  const wallet = await pool.query(`SELECT * FROM "Wallet" WHERE "userId" = 5;`);
  console.log('\nUser 5 wallet:', JSON.stringify(wallet.rows, null, 2));

  await pool.end();
}

run().catch(console.error);
