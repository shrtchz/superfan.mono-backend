import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailModule } from '../mail/mail.module';
import { TaskModule } from '../tasks/tasks.module';
import { WalletModule } from '../wallet/wallet.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [ConfigModule, MailModule, HttpModule, TaskModule, WalletModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
