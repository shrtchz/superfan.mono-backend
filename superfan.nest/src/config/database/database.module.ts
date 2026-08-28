import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AutoSeedService } from './auto-seed.service';

@Module({
  imports: [],
  providers: [PrismaService, AutoSeedService],
  exports: [PrismaService],
})
export class DatabaseModule {}
