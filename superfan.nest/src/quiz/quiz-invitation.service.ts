import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { prisma } from '../prisma/prisma';
import { NotificationGateway } from '../notification/notification.gateway';
import { NotificationService } from '../notification/notification.service';
import { QuizSessionService } from './quiz-session.service';
import { SendQuizInvitationDto } from './dto/quiz-session.dto';

@Injectable()
export class QuizInvitationService {
  private readonly logger = new Logger(QuizInvitationService.name);

  constructor(
    private readonly notificationGateway: NotificationGateway,
    private readonly notificationService: NotificationService,
    private readonly quizSessionService: QuizSessionService,
  ) {}

  /**
   * Send a quiz invitation to a registered user
   */
  async sendInvitation(senderId: number, dto: SendQuizInvitationDto) {
    if (senderId === dto.recipientId) {
      throw new BadRequestException('You cannot invite yourself to a quiz');
    }

    const recipient = await prisma.user.findUnique({
      where: { id: dto.recipientId },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        profilePicture: true,
      },
    });

    if (!recipient) {
      throw new NotFoundException('Recipient user not found');
    }

    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        profilePicture: true,
      },
    });

    if (!sender) {
      throw new NotFoundException('Sender user not found');
    }

    const senderDisplayName =
      `${sender.firstName || ''} ${sender.lastName || ''}`.trim() ||
      sender.username ||
      'A user';

    // 1) Ensure or find session
    let sessionId = dto.sessionId;
    if (sessionId) {
      const existingSession = await prisma.quizSession.findUnique({
        where: { id: sessionId },
      });
      if (!existingSession) {
        throw new NotFoundException(`Quiz session ${sessionId} not found`);
      }
      if (existingSession.status === 'COMPLETED' || existingSession.status === 'CANCELLED') {
        throw new BadRequestException('Cannot invite to a completed or cancelled quiz session');
      }
    } else {
      // Create new session
      const newSession = await this.quizSessionService.createSession(senderId, {
        quizId: dto.quizId,
        quizTitle: dto.quizTitle,
      });
      sessionId = newSession.session.id;
    }

    // 2) Check for existing invitation in this session
    const existingInvite = await prisma.quizInvitation.findUnique({
      where: {
        sessionId_recipientId: {
          sessionId,
          recipientId: dto.recipientId,
        },
      },
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes validity

    let invitation;
    if (existingInvite) {
      if (existingInvite.status === 'PENDING' && existingInvite.expiresAt > now) {
        throw new BadRequestException('An invitation is already pending for this user in this session');
      }
      if (existingInvite.status === 'ACCEPTED') {
        throw new BadRequestException('User has already accepted an invitation to this session');
      }
      // Re-issue or reactivate
      invitation = await prisma.quizInvitation.update({
        where: { id: existingInvite.id },
        data: {
          status: 'PENDING',
          expiresAt,
          updatedAt: now,
        },
      });
    } else {
      invitation = await prisma.quizInvitation.create({
        data: {
          sessionId,
          quizId: dto.quizId,
          quizTitle: dto.quizTitle,
          senderId,
          recipientId: dto.recipientId,
          status: 'PENDING',
          expiresAt,
        },
      });
    }

    // 3) Deliver in-app notification & real-time socket events
    await this.notificationService.quizInvitationSent(
      dto.recipientId,
      senderDisplayName,
      dto.quizTitle,
      invitation.id,
      sessionId,
    );

    const invitePayload = {
      invitationId: invitation.id,
      sessionId,
      quizId: dto.quizId,
      quizTitle: dto.quizTitle,
      sender: {
        id: sender.id,
        username: sender.username,
        displayName: senderDisplayName,
        profilePicture: sender.profilePicture,
      },
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };

    this.notificationGateway.sendQuizEvent(
      [dto.recipientId],
      'quiz:invitation_received',
      invitePayload,
    );

    return {
      success: true,
      invitation,
      sessionId,
    };
  }

  /**
   * Accept an invitation and register recipient in the shared quiz session
   */
  async acceptInvitation(recipientId: number, invitationId: string) {
    const invitation = await prisma.quizInvitation.findUnique({
      where: { id: invitationId },
      include: {
        session: true,
        recipient: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.recipientId !== recipientId) {
      throw new ForbiddenException('You are not authorized to accept this invitation');
    }

    if (invitation.status === 'ACCEPTED') {
      throw new BadRequestException('Invitation has already been accepted');
    }

    if (invitation.status !== 'PENDING') {
      throw new BadRequestException(`Invitation is no longer pending (${invitation.status})`);
    }

    if (new Date() > invitation.expiresAt) {
      await prisma.quizInvitation.update({
        where: { id: invitationId },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException('This invitation has expired');
    }

    if (invitation.session.status === 'COMPLETED' || invitation.session.status === 'CANCELLED') {
      throw new BadRequestException('This quiz session is no longer active');
    }

    // Atomic update & participant addition
    await prisma.$transaction(async (tx) => {
      await tx.quizInvitation.update({
        where: { id: invitationId },
        data: { status: 'ACCEPTED' },
      });

      await tx.quizSessionParticipant.upsert({
        where: {
          sessionId_userId: {
            sessionId: invitation.sessionId,
            userId: recipientId,
          },
        },
        create: {
          sessionId: invitation.sessionId,
          userId: recipientId,
          status: 'NOT_STARTED',
          score: 0,
        },
        update: {
          status: 'NOT_STARTED',
        },
      });

      if (invitation.session.status === 'PENDING') {
        await tx.quizSession.update({
          where: { id: invitation.sessionId },
          data: { status: 'ACTIVE', startedAt: new Date() },
        });
      }
    });

    const recipientDisplayName =
      `${invitation.recipient.firstName || ''} ${invitation.recipient.lastName || ''}`.trim() ||
      invitation.recipient.username ||
      'A user';

    // Notify sender
    await this.notificationService.quizInvitationAccepted(
      invitation.senderId,
      recipientDisplayName,
      invitation.quizTitle,
    );

    this.notificationGateway.sendQuizEvent(
      [invitation.senderId],
      'quiz:invitation_accepted',
      {
        invitationId,
        recipientId,
        sessionId: invitation.sessionId,
        recipient: invitation.recipient,
      },
    );

    // Broadcast updated scoreboard to session
    const sessionData = await this.quizSessionService.getSession(invitation.sessionId, recipientId);
    this.notificationGateway.broadcastToQuizSession(
      invitation.sessionId,
      'quiz:scoreboard_update',
      {
        sessionId: invitation.sessionId,
        scoreboard: sessionData.participants,
        status: 'ACTIVE',
        timestamp: new Date().toISOString(),
      },
    );

    return {
      success: true,
      sessionId: invitation.sessionId,
      quizId: invitation.quizId,
      quizTitle: invitation.quizTitle,
    };
  }

  /**
   * Decline an invitation
   */
  async declineInvitation(recipientId: number, invitationId: string) {
    const invitation = await prisma.quizInvitation.findUnique({
      where: { id: invitationId },
      include: {
        recipient: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.recipientId !== recipientId) {
      throw new ForbiddenException('You are not authorized to decline this invitation');
    }

    if (invitation.status !== 'PENDING') {
      throw new BadRequestException(`Invitation is no longer pending (${invitation.status})`);
    }

    await prisma.quizInvitation.update({
      where: { id: invitationId },
      data: { status: 'DECLINED' },
    });

    const recipientDisplayName =
      `${invitation.recipient.firstName || ''} ${invitation.recipient.lastName || ''}`.trim() ||
      invitation.recipient.username ||
      'A user';

    await this.notificationService.quizInvitationDeclined(
      invitation.senderId,
      recipientDisplayName,
      invitation.quizTitle,
    );

    this.notificationGateway.sendQuizEvent(
      [invitation.senderId],
      'quiz:invitation_declined',
      {
        invitationId,
        recipientId,
        sessionId: invitation.sessionId,
      },
    );

    return { success: true };
  }

  /**
   * List pending invitations for the current user
   */
  async getPendingInvitations(userId: number) {
    const now = new Date();
    const invitations = await prisma.quizInvitation.findMany({
      where: {
        recipientId: userId,
        status: 'PENDING',
        expiresAt: { gt: now },
        session: {
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
          },
        },
        session: {
          select: {
            id: true,
            quizId: true,
            quizTitle: true,
            status: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return invitations.map((inv) => ({
      id: inv.id,
      sessionId: inv.sessionId,
      quizId: inv.quizId,
      quizTitle: inv.quizTitle,
      senderId: inv.senderId,
      sender: {
        id: inv.sender.id,
        username: inv.sender.username,
        name: `${inv.sender.firstName || ''} ${inv.sender.lastName || ''}`.trim() || inv.sender.username,
        avatar: inv.sender.profilePicture,
      },
      status: inv.status,
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
    }));
  }

  /**
   * List sent invitations for the current user
   */
  async getSentInvitations(userId: number) {
    const invitations = await prisma.quizInvitation.findMany({
      where: {
        senderId: userId,
      },
      include: {
        recipient: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return invitations.map((inv) => ({
      id: inv.id,
      sessionId: inv.sessionId,
      quizId: inv.quizId,
      quizTitle: inv.quizTitle,
      recipientId: inv.recipientId,
      recipient: {
        id: inv.recipient.id,
        username: inv.recipient.username,
        name: `${inv.recipient.firstName || ''} ${inv.recipient.lastName || ''}`.trim() || inv.recipient.username,
        avatar: inv.recipient.profilePicture,
      },
      status: inv.status,
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
    }));
  }
}
