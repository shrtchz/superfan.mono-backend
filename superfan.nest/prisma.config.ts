import dotenv from 'dotenv';
import * as path from 'node:path';
import { env, PrismaConfig } from 'prisma/config';

// Load Render secret file, root .env first, then local .env
dotenv.config({ path: '/etc/secrets/.env' });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config();

export default {
  datasource: {
    url: env('DATABASE_URL') || env('PROD_DB_URL'),
  },
  schema: path.join('prisma', 'schema'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'pnpm exec tsx prisma/seed/seed.ts',
    // prisma\seed\seed.ts
  },
} satisfies PrismaConfig;
