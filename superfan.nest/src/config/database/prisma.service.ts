import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL as string,
      connectionTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      max: 10,
      ssl: {
        rejectUnauthorized: false,
      },
    });
    const adapter = new PrismaPg(pool);
    super({ adapter, log: ['info', 'warn', 'error'] });
  }

//   async onModuleInit() {
//     try {
//       await this.$connect();
//       await this.$queryRaw`SELECT 1`;
//       console.log('✅ Prisma connected to MySQL');
//     } catch (error) {
//       console.error('❌ Prisma connection error:', error);
//       throw error;
//     }
//   }

//   async onModuleDestroy() {
//     await this.$disconnect();
//     console.log('🔌 Prisma disconnected from MySQL');
//   }
}