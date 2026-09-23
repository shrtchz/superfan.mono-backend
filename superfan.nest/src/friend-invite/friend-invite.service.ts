import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma } from '../prisma/prisma';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class FriendInviteService {
  constructor(private readonly notificationService: NotificationService) {}

  async send(senderId: number, receiverId: number) {
    if (senderId === receiverId) {
      throw new BadRequestException('You cannot invite yourself');
    }

    const receiver = await prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, username: true, firstName: true },
    });

    if (!receiver) {
      throw new NotFoundException('User not found');
    }

    const existing = await prisma.challengeInvite.findUnique({
      where: {
        senderId_receiverId: { senderId, receiverId },
      },
    });

    if (existing) {
      if (existing.status === 'pending') {
        throw new BadRequestException('Invite already sent');
      }
      const updated = await prisma.challengeInvite.update({
        where: { id: existing.id },
        data: { status: 'pending' },
      });
      await this.notificationService.challengeInviteSent(
        receiverId,
        (await this.getSenderUsername(senderId)) || 'A user',
      );
      return { success: true, invite: updated };
    }

    const invite = await prisma.challengeInvite.create({
      data: { senderId, receiverId },
    });

    await this.notificationService.challengeInviteSent(
      receiverId,
      (await this.getSenderUsername(senderId)) || 'A user',
    );

    return { success: true, invite };
  }

  async accept(inviteId: number) {
    const invite = await prisma.challengeInvite.findUnique({
      where: { id: inviteId },
    });

    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    if (invite.status === 'accepted') {
      throw new BadRequestException('Invite already accepted');
    }

    await prisma.$transaction([
      prisma.challengeInvite.update({
        where: { id: inviteId },
        data: { status: 'accepted' },
      }),
      prisma.friend.create({
        data: { userId: invite.senderId, friendId: invite.receiverId },
      }),
      prisma.friend.create({
        data: { userId: invite.receiverId, friendId: invite.senderId },
      }),
    ]);

    const receiver = await prisma.user.findUnique({
      where: { id: invite.receiverId },
      select: { username: true, firstName: true },
    });

    await this.notificationService.challengeInviteAccepted(
      invite.senderId,
      receiver?.username || receiver?.firstName || 'a user',
    );

    return { success: true };
  }

  async decline(inviteId: number) {
    const invite = await prisma.challengeInvite.findUnique({
      where: { id: inviteId },
    });

    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    if (invite.status === 'declined') {
      throw new BadRequestException('Invite already declined');
    }

    await prisma.challengeInvite.update({
      where: { id: inviteId },
      data: { status: 'declined' },
    });

    const receiver = await prisma.user.findUnique({
      where: { id: invite.receiverId },
      select: { username: true, firstName: true },
    });

    await this.notificationService.challengeInviteDeclined(
      invite.senderId,
      receiver?.username || receiver?.firstName || 'a user',
    );

    return { success: true };
  }

  async pending(userId: number) {
    const invites = await prisma.challengeInvite.findMany({
      where: { receiverId: userId, status: 'pending' },
      include: {
        sender: {
          select: { id: true, username: true, firstName: true, profilePicture: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const count = invites.length;

    return {
      success: true,
      data: invites.map((invite) => ({
        id: invite.id,
        name:
          invite.sender.username ||
          invite.sender.firstName ||
          `user_${invite.sender.id}`,
        username: invite.sender.username,
        avatar: invite.sender.profilePicture,
        mutual: 'No mutual connections',
        createdAt: invite.createdAt,
      })),
      count,
    };
  }

  async friends(userId: number) {
    const rows = await prisma.friend.findMany({
      where: { userId },
      include: {
        friend: {
          select: {
            id: true,
            username: true,
            firstName: true,
            profilePicture: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: rows.map((row) => ({
        id: row.friend.id,
        username: row.friend.username,
        name: row.friend.username || row.friend.firstName,
        avatar: row.friend.profilePicture,
      })),
      count: rows.length,
    };
  }

  private async getSenderUsername(senderId: number): Promise<string | null> {
    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      select: { username: true, firstName: true },
    });
    return sender?.username || sender?.firstName || null;
  }
}