import { Controller, Get, Param, Patch, Delete } from '@nestjs/common';
import { ApiRoutes } from '../common/enums/routes.enum';
import { NotificationService } from './notification.service';

@Controller(ApiRoutes.NOTIFICATION)
export class NotificationController {
  constructor(private notificationService: NotificationService) {}


@Get('/:userId')
getUserNotifications(@Param('userId') userId: number) {
  // const userId = req.user.id; // from auth (JWT / Clerk / Passport)
  return this.notificationService.findNotificationByUserId(userId);
}

  @Get(':userId/unread-count')
  getUnreadCount(@Param('userId') userId: string) {
    return this.notificationService.getUnreadCount(Number(userId));
  }

  @Patch(':notificationId/read')
  markAsRead(@Param('notificationId') notificationId: string) {
    return this.notificationService.markAsRead(Number(notificationId));
  }

  @Patch(':userId/read-all')
  markAllAsRead(@Param('userId') userId: string) {
    return this.notificationService.markAllAsRead(Number(userId));
  }

@Delete('/:userId')
deleteNotifications(@Param('userId') userId: number) {
  // const userId = req.user.id; // from auth (JWT / Clerk / Passport)
  return this.notificationService.deleteNotificationsByUserId(userId);
}

@Delete('/:notificationId')
deleteNotification(@Param('notificationId') notificationId: number) {
  // const userId = req.user.id; // from auth (JWT / Clerk / Passport)
  return this.notificationService.deleteNotificationByUserId(notificationId);
}
}