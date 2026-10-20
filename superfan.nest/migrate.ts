import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { createClerkClient } from '@clerk/backend';

// 1. Find and load the environment file (supporting "env" or ".env")
function loadEnv() {
  const dirs = [__dirname, path.resolve(__dirname, '..')];
  let envPath = '';
  
  for (const dir of dirs) {
    const candidateEnv = path.join(dir, 'env');
    if (fs.existsSync(candidateEnv)) {
      envPath = candidateEnv;
      break;
    }
    const candidateDotEnv = path.join(dir, '.env');
    if (fs.existsSync(candidateDotEnv)) {
      envPath = candidateDotEnv;
      break;
    }
  }
  
  if (envPath) {
    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const index = trimmed.indexOf('=');
        if (index > 0) {
          const key = trimmed.slice(0, index).trim();
          let value = trimmed.slice(index + 1).trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      });
      console.log(`✅ Loaded environment variables from: ${envPath}`);
    } catch (e: any) {
      console.error(`⚠️ Failed to parse environment file: ${e.message}`);
    }
  } else {
    console.log('⚠️ Warning: No "env" or ".env" file found. Using existing process.env variables.');
  }
}

// Load env variables BEFORE importing Prisma so that DATABASE_URL is defined
loadEnv();

import { prisma } from './src/prisma/prisma';

async function syncUsersToClerk() {
  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  if (!clerkSecretKey) {
    console.warn('⚠️ Warning: CLERK_SECRET_KEY is missing. Skipping user sync to Clerk.');
    return;
  }

  const clerkClient = createClerkClient({ secretKey: clerkSecretKey });

  try {
    console.log('\n📦 Syncing database users to Clerk...');
    const users = await prisma.user.findMany();
    console.log(`Found ${users.length} user(s) in local database.`);

    for (const user of users) {
      process.stdout.write(`👤 Syncing: ${user.email} ... `);

      try {
        // Check if user already exists in Clerk
        const clerkUsers = await clerkClient.users.getUserList({
          emailAddress: [user.email],
        });
        const existingClerkUser = clerkUsers?.data?.[0] || clerkUsers?.[0];

        if (existingClerkUser) {
          console.log(`⏭️ already exists (Clerk ID: ${existingClerkUser.id})`);
          continue;
        }

        // Prepare Clerk payload
        const payload: any = {
          emailAddress: [user.email],
          username: user.username || undefined,
          firstName: user.firstName || 'User',
          lastName: user.lastName || '',
          skipPasswordChecks: true,
          skipPasswordRequirement: !user.password,
        };

        // Import password hash directly if it is Argon2
        if (user.password && user.password.startsWith('$argon2')) {
          payload.passwordHasher = 'argon2id';
          payload.passwordDigest = user.password;
        }

        if (user.phone) {
          let cleanPhone = user.phone.trim();
          if (!cleanPhone.startsWith('+')) {
            if (cleanPhone.startsWith('0')) {
              cleanPhone = `+234${cleanPhone.slice(1)}`;
            } else {
              cleanPhone = `+${cleanPhone}`;
            }
          }
          payload.phoneNumber = [cleanPhone];
        }

        const newClerkUser = await clerkClient.users.createUser(payload);
        
        // Mark email as verified
        if (newClerkUser?.emailAddresses?.[0]?.id) {
          await clerkClient.emailAddresses.updateEmailAddress(
            newClerkUser.emailAddresses[0].id,
            { verified: true }
          );
        }

        console.log(`✅ created (Clerk ID: ${newClerkUser.id})`);

      } catch (userErr: any) {
        console.log(`❌ FAILED: ${userErr?.message || userErr}`);
        if (userErr.errors) {
          console.log('   Clerk details:', JSON.stringify(userErr.errors, null, 2));
        }
      }
    }
    console.log('🎉 Clerk synchronization completed.');
  } catch (error: any) {
    console.error('❌ Failed to complete Clerk user sync:', error.message);
  }
}

async function run() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ Error: DATABASE_URL environment variable is missing.');
    process.exit(1);
  }

  const maskedUrl = dbUrl.replace(/:([^@]+)@/, ':******@');
  console.log(`🔗 Connecting to database: ${maskedUrl}\n`);

  try {
    // 2. Deploy pending migrations
    console.log('⚙️ Running Prisma migrations (migrate deploy)...');
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    console.log('✅ Migrations applied successfully.');

    // 3. Generate Prisma Client to keep types in sync
    console.log('\n⚙️ Generating Prisma Client...');
    execSync('npx prisma generate', { stdio: 'inherit' });
    console.log('✅ Prisma Client generated successfully.');

  } catch (error: any) {
    console.error('\n❌ Migration process failed:', error.message);
    process.exit(1);
  }

  try {
    await syncUsersToClerk();
  } finally {
    await prisma.$disconnect();
  }
}

run();
