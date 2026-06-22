import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
//   implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL as string,
    });
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