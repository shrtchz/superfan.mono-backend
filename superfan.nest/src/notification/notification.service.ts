import { Injectable } from '@nestjs/common';
import { prisma } from '../prisma/prisma';
import { NotificationGateway } from './notification.gateway';

@Injectable()
export class NotificationService {
  constructor(private gateway: NotificationGateway) {}

  async createNotification(userId: number, title: string, message: string, type?: string) {
    const notification = await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        type
      },
    });

    // realtime websocket
    let check_notif = await this.gateway.sendNotificationToUser(
      userId,
      notification,
    );

    return notification;
  }

  findNotificationByUserId(userId: number) {
    return prisma.notification.findMany({
      where: {
        userId: userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getUnreadCount(userId: number) {
    return prisma.notification.count({
      where: {
        userId,
        read: false,
      },
    });
  }

  async markAsRead(notificationId: number) {
    return prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });
  }

  async markAllAsRead(userId: number) {
    return prisma.notification.updateMany({
      where: {
        userId,
        read: false,
      },
      data: {
        read: true,
      },
    });
  }

  deleteNotificationsByUserId(userId: number) {
    return prisma.notification.deleteMany({
      where: {
        userId: userId,
      },
    });
  }

  deleteNotificationByUserId(notificationId: number) {
    return prisma.notification.delete({
      where: {
        id: notificationId,
      },
    });
  }
}
