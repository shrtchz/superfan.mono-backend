import dotenv from 'dotenv';
import * as path from 'path';

// Load Render secret file, root .env first, then local .env
dotenv.config({ path: '/etc/secrets/.env' });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Make sure .env is loaded before running the seed script.');
}

const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 10,
  ssl: {
    rejectUnauthorized: false,
  },
});

export const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});
