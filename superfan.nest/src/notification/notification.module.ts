import { Global, Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationGateway } from './notification.gateway';
import { NotificationService } from './notification.service';
import { PushNotificationController } from './push-notification.controller';
import { PushNotificationService } from './push-notification.service';

@Global()
@Module({
  controllers: [NotificationController, PushNotificationController],
  providers: [NotificationService, NotificationGateway, PushNotificationService],
  exports: [NotificationService, PushNotificationService, NotificationGateway],
})
export class NotificationModule {}