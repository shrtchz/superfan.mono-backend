const { Pool } = require('pg');

const urls = [
  { name: 'ep-curly-sun (Superfan)', url: 'postgresql://neondb_owner:npg_B3duIEGcRao8@ep-curly-sun-ayt1m9dk-pooler.c-5.us-east-2.aws.neon.tech/Superfan?sslmode=require' },
  { name: 'ep-curly-sun (neondb)', url: 'postgresql://neondb_owner:npg_B3duIEGcRao8@ep-curly-sun-ayt1m9dk-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require' },
  { name: 'ep-old-sun (neondb)', url: 'postgresql://neondb_owner:npg_ftzWGd1u4HIb@ep-old-sun-aym7tkqe-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require' },
  { name: 'ep-frosty-poetry (neondb)', url: 'postgresql://neondb_owner:npg_YpfzV2Ziv6FD@ep-frosty-poetry-ayrkt4uz-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require' },
  { name: 'ep-wispy-breeze (neondb)', url: 'postgresql://neondb_owner:npg_mct1L3EGhNjO@ep-wispy-breeze-atpun0yq-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require' },
];

async function check() {
  for (const item of urls) {
    try {
      const pool = new Pool({ connectionString: item.url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
      const res = await pool.query('SELECT max(id) as max_id, count(*) as count FROM "WalletTransaction";');
      console.log(`[${item.name}]: count = ${res.rows[0].count}, max_id = ${res.rows[0].max_id}`);
      const u5 = await pool.query('SELECT id, amount, trx_ref FROM "WalletTransaction" WHERE id IN (124, 123, 122);');
      if (u5.rows.length > 0) {
        console.log(`  >>> FOUND TARGET TRANSACTIONS IN ${item.name}:`, u5.rows);
      }
      await pool.end();
    } catch (e) {
      console.log(`[${item.name}]: ERROR: ${e.message}`);
    }
  }
}

check().catch(console.error);
