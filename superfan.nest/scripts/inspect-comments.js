const { Pool } = require('pg');
require('dotenv').config();

const PROD_URL = 'postgresql://neondb_owner:npg_5XsMBJDpZ2jz@ep-silent-violet-aylk8d6w-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

async function run() {
  const pool = new Pool({ connectionString: PROD_URL, ssl: { rejectUnauthorized: false } });

  // Get StreamComment columns
  const cols = await pool.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'StreamComment' ORDER BY ordinal_position;
  `);
  console.log('StreamComment columns:', cols.rows.map(r => r.column_name));

  // Get comments for userId 5 that look like live quiz answers
  const comments = await pool.query(`
    SELECT id, "userId", message, "createdAt", "streamId"
    FROM "StreamComment"
    WHERE "userId" = 5
    ORDER BY "createdAt" DESC
    LIMIT 20;
  `);
  console.log('\nUser 5 recent comments:', JSON.stringify(comments.rows, null, 2));

  await pool.end();
}

run().catch(console.error);
