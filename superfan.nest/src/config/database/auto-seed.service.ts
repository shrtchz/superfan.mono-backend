import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { execSync } from 'child_process';
import { PrismaService } from './prisma.service';

@Injectable()
export class AutoSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AutoSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    process.env.NEST_APP_INIT = 'true';
    try {
      // 1. Check if database tables exist by probing the Role table
      let tablesExist = true;
      try {
        await this.prisma.role.count();
      } catch (err: any) {
        tablesExist = false;
      }

      // 2. If tables are missing, push the Prisma schema to create all tables
      if (!tablesExist) {
        this.logger.log('🔨 Database tables are missing. Running schema push (npx prisma db push)...');
        try {
          execSync('npx prisma db push --accept-data-loss', {
            stdio: 'inherit',
            env: { ...process.env },
          });
          this.logger.log('✅ Database tables created successfully via prisma db push!');
        } catch (pushErr: any) {
          this.logger.error(`Failed to push schema tables: ${pushErr?.message || pushErr}`);
        }
      }

      // 3. Check if base seed data (roles) exists
      const roleCount = await this.prisma.role.count().catch(() => 0);
      if (roleCount === 0) {
        this.logger.log('🌱 Database is missing seed data. Running auto-seed...');
        const seedModule = require('../../../prisma/seed/seed');
        if (typeof seedModule.seedAll === 'function') {
          await seedModule.seedAll(this.prisma);
        }
        this.logger.log('✅ Auto-seed completed successfully!');
      }
    } catch (error: any) {
      this.logger.warn(`Auto-seed error: ${error?.message || error}`);
    }
  }
}
