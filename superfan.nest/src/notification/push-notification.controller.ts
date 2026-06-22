import { Body, Controller, Post } from '@nestjs/common';
import { ApiRoutes } from '../common/enums/routes.enum';
import { PushNotificationService } from './push-notification.service';
import { SendToAllUsersDto, SendToUsersDto } from './notification.dto';



@Controller(ApiRoutes.NOTIFICATION)
export class PushNotificationController {
  constructor(private pushNotificationService: PushNotificationService) {}

  /**
   * Send push notification to all users
   * POST /api/v1/notification/push/all
   */
  @Post('push/all')
  sendToAllUsers(@Body() dto: SendToAllUsersDto) {
    return this.pushNotificationService.sendPushNotificationToAllUsers(
      dto.title,
      dto.message,
    );
  }

  /**
   * Send push notification to specific users
   * POST /api/v1/notification/push/users
   */
  @Post('push/users')
  sendToUsers(@Body() dto: SendToUsersDto) {
    return this.pushNotificationService.sendPushNotificationToUsers(
      dto.userIds,
      dto.title,
      dto.message,
    );
  }
}