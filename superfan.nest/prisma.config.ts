import dotenv from 'dotenv';
import * as path from 'node:path';
import { env, PrismaConfig } from 'prisma/config';

// Load Render secret file, root .env first, then local .env
dotenv.config({ path: '/etc/secrets/.env' });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config();

const dbUrl = (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) ||
              (process.env.PROD_DB_URL && process.env.PROD_DB_URL.trim());

const isGenerateCommand = process.argv.some(arg => arg.includes('generate'));

if (!dbUrl && !isGenerateCommand) {
  throw new Error('DATABASE_URL is not set. Make sure DATABASE_URL is present in your .env file or environment.');
}

const finalUrl = dbUrl || 'postgresql://placeholder:placeholder@localhost:5432/placeholder';

export default {
  datasource: {
    url: finalUrl,
  },
  schema: path.join('prisma', 'schema'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'pnpm exec tsx prisma/seed/seed.ts',
    // prisma\seed\seed.ts
  },
} satisfies PrismaConfig;
