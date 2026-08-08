import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationService } from '../notification/notification.service';
import { MonnifyWebhookController } from './webhook.controller';
import { MonnifyWebhookService } from './webhook.service';

@Module({
  imports: [ConfigModule, HttpModule],
  controllers: [MonnifyWebhookController],
  providers: [MonnifyWebhookService, NotificationService, ],
  exports: [MonnifyWebhookService],
})
export class WebhookModule {}