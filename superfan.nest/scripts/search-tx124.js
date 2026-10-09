const { Pool } = require('pg');

const urls = [
  'postgresql://neondb_owner:npg_B3duIEGcRao8@ep-curly-sun-ayt1m9dk-pooler.c-5.us-east-2.aws.neon.tech/Superfan?sslmode=require',
  'postgresql://neondb_owner:npg_ftzWGd1u4HIb@ep-old-sun-aym7tkqe-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require',
  'postgresql://neondb_owner:npg_YpfzV2Ziv6FD@ep-frosty-poetry-ayrkt4uz-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require',
  'postgresql://neondb_owner:npg_mct1L3EGhNjO@ep-wispy-breeze-atpun0yq-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require',
];

async function check() {
  for (const u of urls) {
    const host = u.split('@')[1].split('/')[0];
    try {
      const pool = new Pool({ connectionString: u, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
      const res = await pool.query(`SELECT id, "userId", amount, trx_ref, "createdAt" FROM "WalletTransaction" WHERE id = 124 OR trx_ref LIKE '%6ac7b85d5d2b24107ab2e57f%';`);
      console.log(`[${host}]: matched rows =`, res.rows);
      await pool.end();
    } catch (e) {
      console.log(`[${host}]: error ${e.message}`);
    }
  }
}

check().catch(console.error);
