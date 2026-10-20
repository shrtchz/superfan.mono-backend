import { Body, Controller, Get, Param, Patch, Post, Delete } from '@nestjs/common';
import { ApiRoutes } from '../common/enums/routes.enum';
import { NotificationService } from './notification.service';

@Controller(ApiRoutes.NOTIFICATION)
export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  @Post('/create')
  async createNotification(
    @Body() body: { userId: number; title: string; message: string; type?: string; data?: any },
  ) {
    return this.notificationService.createNotification(
      body.userId,
      body.title,
      body.message,
      body.type || 'live_quiz_reward',
    );
  }

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