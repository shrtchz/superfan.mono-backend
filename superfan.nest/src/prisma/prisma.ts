import dotenv from 'dotenv';
import * as path from 'path';

// Load root .env first, then local .env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

// import { prisma } from "./prisma";

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
// import { PrismaClient } from '../generated/prisma/client';
// import { PrismaClient } from './src/generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Make sure .env is loaded before running the seed script.');
}

export const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString,
  }),
});