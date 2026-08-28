import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AutoSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AutoSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    process.env.NEST_APP_INIT = 'true';
    try {
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
      this.logger.warn(`Auto-seed check: ${error?.message || error}`);
    }
  }
}
