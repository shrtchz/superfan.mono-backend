import { Injectable } from '@nestjs/common';
import { prisma } from '../prisma/prisma';
import { NotificationGateway } from './notification.gateway';

@Injectable()
export class PushNotificationService {
  constructor(private gateway: NotificationGateway) {}

  /**
   * Send push notification to all users
   * This broadcasts to all connected WebSocket clients
   */
  async sendPushNotificationToAllUsers(title: string, message: string) {
    // Create notification for all users (optional - create in bulk)
    const users = await prisma.user.findMany({
      select: { id: true },
    });

    const notifications = await Promise.all(
      users.map((user) =>
        prisma.notification.create({
          data: {
            userId: user.id,
            title,
            message,
          },
        }),
      ),
    );

    // Send real-time notification via WebSocket to all users
    await this.gateway.sendNotificationToAllUsers({
      title,
      message,
      createdAt: new Date(),
    });

    return {
      success: true,
      totalUsers: users.length,
      notificationsCreated: notifications.length,
    };
  }

  /**
   * Send push notification to specific users by their IDs
   */
  async sendPushNotificationToUsers(
    userIds: number[],
    title: string,
    message: string,
  ) {
    const notifications = await Promise.all(
      userIds.map((userId) =>
        prisma.notification.create({
          data: {
            userId,
            title,
            message,
          },
        }),
      ),
    );

    // Send real-time notifications via WebSocket
    await Promise.all(
      userIds.map((userId) =>
        this.gateway.sendNotificationToUser(userId, {
          title,
          message,
          createdAt: new Date(),
        }),
      ),
    );

    return {
      success: true,
      totalUsers: userIds.length,
      notificationsCreated: notifications.length,
    };
  }
}