const { Pool } = require('pg');
require('dotenv').config();

const PROD_URL = 'postgresql://neondb_owner:npg_5XsMBJDpZ2jz@ep-silent-violet-aylk8d6w-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

// The quiz finish time from liveQuizAttempt.completedAt for quizId=6ac7b85d5d2b24107ab2e57f, userId=5
// = 2026-10-09T17:34:07.231Z
// But the comment was posted at 2026-10-09T15:18:28.012Z (correct original time from user's actual post)
// 
// QUESTION: The user asked to backfill the comment time to when the user ACTUALLY answered the live quiz.
// The comment at id=5 was posted at 15:18:28 UTC — that looks like it's close to tx 124 (live_quiz_reward at 15:16).
// The quiz completedAt is 17:34:07 UTC — that's later.
//
// The "original time user answered the quiz" = when they submitted the comment = 15:18:28 is already correct!
// The completedAt of 17:34:07 is when the BACKFILL ran and set isCompleted=true, not when they actually answered.
//
// Let's check all comments for that streamId to understand the timeline
async function run() {
  const pool = new Pool({ connectionString: PROD_URL, ssl: { rejectUnauthorized: false } });

  // All comments on stream 12 (the live quiz stream) to understand timeline
  const allComments = await pool.query(`
    SELECT id, "userId", message, "createdAt", "isWinner", "winAmount"
    FROM "StreamComment"
    WHERE "streamId" = 12
    ORDER BY "createdAt" ASC;
  `);
  console.log('All comments on stream 12 (live quiz stream):', JSON.stringify(allComments.rows, null, 2));

  // Check ongoingLiveQuiz for this quizId to understand when quiz actually ended
  const ongoing = await pool.query(`
    SELECT id, "userId", "quizIds", "completed", "updatedAt", "createdAt"
    FROM "OngoingLiveQuiz"
    WHERE "quizIds"::text LIKE '%6ac7b85d5d2b24107ab2e57f%'
    ORDER BY id;
  `);
  console.log('\nOngoingLiveQuiz for quiz 6ac7b85d5d2b24107ab2e57f:', JSON.stringify(ongoing.rows, null, 2));

  await pool.end();
}

run().catch(console.error);
