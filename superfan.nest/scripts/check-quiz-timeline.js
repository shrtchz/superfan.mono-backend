const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const ongoing = await pool.query(`SELECT * FROM ongoing_live_quiz WHERE id = 3 OR "userId" = '5' ORDER BY id;`);
  console.log('ongoing_live_quiz:', JSON.stringify(ongoing.rows, null, 2));

  const comments = await pool.query(`SELECT id, "userId", message, "createdAt" FROM "StreamComment" WHERE "streamId" = 12;`);
  console.log('All stream 12 comments:', JSON.stringify(comments.rows, null, 2));

  const attempts = await pool.query(`SELECT * FROM live_quiz_attempts ORDER BY id;`);
  console.log('All live_quiz_attempts:', JSON.stringify(attempts.rows, null, 2));

  await pool.end();
}

run().catch(e => { console.error(e.message); pool.end(); });
