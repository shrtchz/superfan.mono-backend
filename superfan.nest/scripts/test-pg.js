const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const res = await pool.query(`SELECT id, "userId", amount, description, trx_ref FROM "WalletTransaction" WHERE "userId" = 5 ORDER BY id DESC LIMIT 10;`);
  console.log('PG ROWS FOR USER 5:');
  console.log(JSON.stringify(res.rows, null, 2));

  const total = await pool.query(`SELECT count(*) FROM "WalletTransaction";`);
  console.log('TOTAL WALLET TX ROWS IN DB:', total.rows[0].count);

  await pool.end();
}

run().catch(console.error);
