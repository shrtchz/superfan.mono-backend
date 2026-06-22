/**
 * reset-and-deallocate.js
 *
 * 1. Fetches all users with a non-null accountReference from the DB.
 * 2. Calls the Monnify API to deallocate each reserved account.
 * 3. Runs `npx prisma migrate reset --force` to wipe all tables.
 *
 * Usage:
 *   node reset-and-deallocate.js
 *
 * Required env vars (add to .env or export before running):
 *   DATABASE_URL       - your Prisma DB connection string
 *   MONNIFY_API_KEY    - Monnify API key
 *   MONNIFY_SECRET_KEY - Monnify secret key
 *   MONNIFY_BASE_URL   - e.g. https://sandbox.monnify.com (no trailing slash)
 */

require('dotenv').config();
const axios = require('axios').default;
const { execSync } = require('child_process');

const { PrismaClient } = require('../prisma/generated/prisma/client')

const prisma = new PrismaClient({})


// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Obtains a short-lived Bearer token from Monnify using Basic Auth.
 * Monnify uses Base64(apiKey:secretKey) for the login endpoint.
 */
async function getMonnifyToken() {
  const { MONNIFY_API_KEY, MONNIFY_URI, MONNIFY_SECRET_KEY } = process.env;

  if (!MONNIFY_API_KEY || !MONNIFY_URI) {
    throw new Error(
      'Missing one or more Monnify env vars: MONNIFY_API_KEY, MONNIFY_SECRET_KEY, MONNIFY_URI'
    );
  }

  const credentials = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET_KEY}`).toString('base64');

  const { data } = await axios.post(
    `${MONNIFY_URI}/api/v1/auth/login`,
    {},
    { headers: { Authorization: `Basic ${credentials}` } }
  );

  const token = data?.responseBody?.accessToken;
  if (!token) throw new Error('Could not retrieve Monnify access token.');
  return token;
}

/**
 * Deallocates a single Monnify reserved account by its accountReference.
 */
async function deallocateAccount(token, accountReference) {
  const { MONNIFY_URI } = process.env;

  const url = `${MONNIFY_URI}/api/v1/bank-transfer/reserved-accounts/reference/${encodeURIComponent(
    accountReference
  )}`;

  const { data } = await axios.delete(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return data;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Step 1 — Fetching users with an accountReference');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const users = await prisma.user.findMany({
    where: { accountReference: { not: null } },
    select: { id: true, email: true, accountReference: true },
  });

  console.log(`Found ${users.length} user(s) with a reserved account.\n`);

  if (users.length > 0) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(' Step 2 — Authenticating with Monnify');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const token = await getMonnifyToken();
    console.log('Monnify token obtained.\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(' Step 3 — Deallocating reserved accounts');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const results = { success: [], failed: [] };

    for (const user of users) {
      const ref = user.accountReference;
      process.stdout.write(`  [User ${user.id}] ${user.email} — ref: ${ref} … `);

      try {
        await deallocateAccount(token, ref);
        console.log('✅ deallocated');
        results.success.push({ id: user.id, ref });
      } catch (err: any) {
        const msg =
          err?.response?.data?.responseMessage ||
          err?.response?.data?.message ||
          err.message;
        console.log(`❌ FAILED — ${msg}`);
        results.failed.push({ id: user.id, ref, reason: msg });
      }
    }

    console.log('\n── Summary ──────────────────────────────────────────');
    console.log(`  ✅ Deallocated : ${results.success.length}`);
    console.log(`  ❌ Failed      : ${results.failed.length}`);

    if (results.failed.length > 0) {
      console.log('\n  Failed references (will still reset DB):');
      results.failed.forEach(({ id, ref, reason }) =>
        console.log(`    User ${id} | ${ref} → ${reason}`)
      );
    }
    console.log('');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Step 4 — Disconnecting Prisma client');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  await prisma.$disconnect();
  console.log('Prisma client disconnected.\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Step 5 — Running npx prisma migrate reset --force');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    execSync('npx prisma migrate reset --force', { stdio: 'inherit' });
    console.log('\n✅ Database reset complete.');
  } catch (err: any) {
    console.error('\n❌ Prisma migrate reset failed:', err.message);
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('\nFatal error:', err.message);
  await prisma.$disconnect();
  process.exit(1);
});