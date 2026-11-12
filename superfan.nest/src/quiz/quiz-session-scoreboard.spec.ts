import { QuizSessionService, ScoreboardRankItem } from './quiz-session.service';
import { QuizInvitationService } from './quiz-invitation.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { prisma } from '../prisma/prisma';

describe('QuizSession & Scoreboard System', () => {
  let sessionService: QuizSessionService;
  let mockNotificationGateway: any;
  let mockNotificationService: any;

  beforeEach(() => {
    mockNotificationGateway = {
      broadcastToQuizSession: jest.fn(),
      sendQuizEvent: jest.fn(),
      broadcastNotification: jest.fn(),
    };
    mockNotificationService = {
      quizInvitationSent: jest.fn(),
      quizInvitationAccepted: jest.fn(),
      quizInvitationDeclined: jest.fn(),
    };
    sessionService = new QuizSessionService(mockNotificationGateway);
  });

  describe('Deterministic Tie-Breaking & Rankings', () => {
    it('ranks participants by score descending', () => {
      const raw = [
        {
          userId: 1,
          score: 100,
          timeSeconds: 30,
          accuracy: 80,
          joinedAt: new Date('2026-01-01T10:00:00Z'),
          status: 'IN_PROGRESS',
          user: { username: 'alice', firstName: 'Alice', lastName: 'Smith' },
        },
        {
          userId: 2,
          score: 250,
          timeSeconds: 45,
          accuracy: 90,
          joinedAt: new Date('2026-01-01T10:01:00Z'),
          status: 'COMPLETED',
          user: { username: 'bob', firstName: 'Bob', lastName: 'Jones' },
        },
      ];

      const ranked = sessionService.sortRankings(raw, 1);
      expect(ranked[0].userId).toBe(2);
      expect(ranked[0].rank).toBe(1);
      expect(ranked[0].score).toBe(250);
      expect(ranked[1].userId).toBe(1);
      expect(ranked[1].rank).toBe(2);
    });

    it('breaks score ties using fastest completion time (ascending)', () => {
      const raw = [
        {
          userId: 1,
          score: 200,
          timeSeconds: 40,
          accuracy: 80,
          joinedAt: new Date('2026-01-01T10:00:00Z'),
          status: 'COMPLETED',
          user: { username: 'alice' },
        },
        {
          userId: 2,
          score: 200,
          timeSeconds: 25,
          accuracy: 80,
          joinedAt: new Date('2026-01-01T10:01:00Z'),
          status: 'COMPLETED',
          user: { username: 'bob' },
        },
      ];

      const ranked = sessionService.sortRankings(raw, 1);
      // Bob is faster (25s vs 40s) with same score
      expect(ranked[0].userId).toBe(2);
      expect(ranked[0].rank).toBe(1);
      expect(ranked[1].userId).toBe(1);
      expect(ranked[1].rank).toBe(2);
    });

    it('breaks score and time ties using highest accuracy (descending)', () => {
      const raw = [
        {
          userId: 1,
          score: 200,
          timeSeconds: 30,
          accuracy: 75,
          joinedAt: new Date('2026-01-01T10:00:00Z'),
          status: 'COMPLETED',
          user: { username: 'alice' },
        },
        {
          userId: 2,
          score: 200,
          timeSeconds: 30,
          accuracy: 95,
          joinedAt: new Date('2026-01-01T10:01:00Z'),
          status: 'COMPLETED',
          user: { username: 'bob' },
        },
      ];

      const ranked = sessionService.sortRankings(raw, 1);
      expect(ranked[0].userId).toBe(2);
      expect(ranked[0].accuracy).toBe(95);
      expect(ranked[1].userId).toBe(1);
    });

    it('correctly flags isCreator on scoreboard entries', () => {
      const raw = [
        {
          userId: 10,
          score: 100,
          timeSeconds: 20,
          accuracy: 100,
          joinedAt: new Date(),
          status: 'IN_PROGRESS',
          user: { username: 'hostUser' },
        },
        {
          userId: 20,
          score: 150,
          timeSeconds: 25,
          accuracy: 100,
          joinedAt: new Date(),
          status: 'IN_PROGRESS',
          user: { username: 'guestUser' },
        },
      ];

      const ranked = sessionService.sortRankings(raw, 10);
      const hostItem = ranked.find((r) => r.userId === 10);
      const guestItem = ranked.find((r) => r.userId === 20);

      expect(hostItem?.isCreator).toBe(true);
      expect(guestItem?.isCreator).toBe(false);
    });
  });

  describe('Session Answer & Authoritative Scoring', () => {
    it('broadcasts scoreboard_update on valid answer submission', async () => {
      const mockSession = {
        id: 'session-123',
        creatorId: 1,
        status: 'PENDING',
        participants: [
          {
            userId: 1,
            score: 0,
            accuracy: 0,
            correctAnswers: 0,
            attemptedAnswers: 0,
            totalQuestions: 0,
            timeSeconds: 0,
            status: 'NOT_STARTED',
            joinedAt: new Date(),
            user: { username: 'alice', firstName: 'Alice' },
          },
        ],
      };

      jest.spyOn(prisma.quizSession, 'findUnique').mockResolvedValue(mockSession as any);
      jest.spyOn(prisma as any, '$transaction').mockImplementation(async (cb: any) => {
        return cb({
          quizSessionParticipant: { update: jest.fn() },
          quizSession: { update: jest.fn() },
        });
      });
      jest.spyOn(prisma.quizSessionParticipant, 'findMany').mockResolvedValue([
        {
          userId: 1,
          score: 50,
          accuracy: 100,
          correctAnswers: 1,
          attemptedAnswers: 1,
          totalQuestions: 1,
          timeSeconds: 5,
          status: 'IN_PROGRESS',
          joinedAt: new Date(),
          user: { username: 'alice', firstName: 'Alice' },
        } as any,
      ]);

      const result = await sessionService.recordAnswer('session-123', 1, {
        questionIndex: 0,
        selectedOption: 'A',
        isCorrect: true,
        pointsEarned: 50,
        timeTakenSeconds: 5,
      });

      expect(result.success).toBe(true);
      expect(mockNotificationGateway.broadcastToQuizSession).toHaveBeenCalledWith(
        'session-123',
        'quiz:scoreboard_update',
        expect.objectContaining({
          sessionId: 'session-123',
          updatedUserId: 1,
        }),
      );
    });

    it('rejects answers when session is already COMPLETED', async () => {
      const mockSession = {
        id: 'session-123',
        status: 'COMPLETED',
        participants: [{ userId: 1, status: 'COMPLETED' }],
      };

      jest.spyOn(prisma.quizSession, 'findUnique').mockResolvedValue(mockSession as any);

      await expect(
        sessionService.recordAnswer('session-123', 1, {
          questionIndex: 1,
          selectedOption: 'B',
          isCorrect: true,
          pointsEarned: 10,
          timeTakenSeconds: 2,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects answers from users who are not participants', async () => {
      const mockSession = {
        id: 'session-123',
        status: 'ACTIVE',
        participants: [{ userId: 1, status: 'IN_PROGRESS' }],
      };

      jest.spyOn(prisma.quizSession, 'findUnique').mockResolvedValue(mockSession as any);

      await expect(
        sessionService.recordAnswer('session-123', 999, {
          questionIndex: 0,
          selectedOption: 'A',
          isCorrect: true,
          pointsEarned: 10,
          timeTakenSeconds: 2,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Session Completion & Result Locking', () => {
    it('locks final rankings when all participants finish', async () => {
      const mockSession = {
        id: 'session-123',
        creatorId: 1,
        status: 'ACTIVE',
        finalRankings: null,
        participants: [
          {
            userId: 1,
            score: 100,
            status: 'IN_PROGRESS',
            timeSeconds: 20,
            accuracy: 100,
            joinedAt: new Date(),
            user: { username: 'alice' },
          },
          {
            userId: 2,
            score: 150,
            status: 'COMPLETED',
            timeSeconds: 15,
            accuracy: 100,
            joinedAt: new Date(),
            user: { username: 'bob' },
          },
        ],
      };

      jest.spyOn(prisma.quizSession, 'findUnique').mockResolvedValue(mockSession as any);
      jest.spyOn(prisma.quizSessionParticipant, 'update').mockResolvedValue({} as any);
      jest.spyOn(prisma.quizSession, 'update').mockResolvedValue({} as any);

      // Now both are completed
      jest.spyOn(prisma.quizSessionParticipant, 'findMany').mockResolvedValue([
        {
          userId: 1,
          score: 100,
          status: 'COMPLETED',
          timeSeconds: 20,
          accuracy: 100,
          joinedAt: new Date(),
          user: { username: 'alice' },
        } as any,
        {
          userId: 2,
          score: 150,
          status: 'COMPLETED',
          timeSeconds: 15,
          accuracy: 100,
          joinedAt: new Date(),
          user: { username: 'bob' },
        } as any,
      ]);

      const result = await sessionService.completeParticipant('session-123', 1);

      expect(result.isCompleted).toBe(true);
      expect(result.isLocked).toBe(true);
      expect(result.winner?.userId).toBe(2); // Bob had 150 pts
      expect(mockNotificationGateway.broadcastToQuizSession).toHaveBeenCalledWith(
        'session-123',
        'quiz:session_completed',
        expect.objectContaining({
          sessionId: 'session-123',
          isLocked: true,
        }),
      );
    });
  });

  describe('QuizInvitationService', () => {
    let invitationService: QuizInvitationService;

    beforeEach(() => {
      invitationService = new QuizInvitationService(
        mockNotificationGateway,
        mockNotificationService,
        sessionService,
      );
    });

    it('prevents self-invitation', async () => {
      await expect(
        invitationService.sendInvitation(1, {
          recipientId: 1,
          quizId: 'quiz-1',
          quizTitle: 'General Knowledge',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('prevents duplicate pending invitations in the same session', async () => {
      jest.spyOn(prisma.user, 'findUnique')
        .mockResolvedValueOnce({ id: 2, username: 'bob' } as any) // recipient
        .mockResolvedValueOnce({ id: 1, username: 'alice' } as any); // sender

      jest.spyOn(prisma.quizSession, 'findUnique').mockResolvedValue({
        id: 'session-1',
        status: 'ACTIVE',
      } as any);

      // Existing pending invite
      jest.spyOn(prisma.quizInvitation, 'findUnique').mockResolvedValue({
        id: 'invite-1',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // still valid
      } as any);

      await expect(
        invitationService.sendInvitation(1, {
          recipientId: 2,
          quizId: 'quiz-1',
          quizTitle: 'General Knowledge',
          sessionId: 'session-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects accepting an already accepted invitation', async () => {
      jest.spyOn(prisma.quizInvitation, 'findUnique').mockResolvedValue({
        id: 'invite-1',
        recipientId: 2,
        status: 'ACCEPTED',
        expiresAt: new Date(Date.now() + 10000),
        session: { status: 'ACTIVE' },
        recipient: { username: 'bob' },
      } as any);

      await expect(invitationService.acceptInvitation(2, 'invite-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects accepting an expired invitation and updates its status', async () => {
      jest.spyOn(prisma.quizInvitation, 'findUnique').mockResolvedValue({
        id: 'invite-1',
        recipientId: 2,
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 10000), // in the past
        session: { status: 'ACTIVE' },
        recipient: { username: 'bob' },
      } as any);

      const updateSpy = jest.spyOn(prisma.quizInvitation, 'update').mockResolvedValue({} as any);

      await expect(invitationService.acceptInvitation(2, 'invite-1')).rejects.toThrow(
        /expired/i,
      );
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'invite-1' },
          data: { status: 'EXPIRED' },
        }),
      );
    });

    it('successfully accepts invitation and notifies sender', async () => {
      jest.spyOn(prisma.quizInvitation, 'findUnique').mockResolvedValue({
        id: 'invite-1',
        sessionId: 'session-1',
        quizId: 'quiz-1',
        quizTitle: 'Yoruba Culture',
        senderId: 1,
        recipientId: 2,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        session: { id: 'session-1', status: 'PENDING' },
        recipient: { id: 2, username: 'bob', firstName: 'Bob', lastName: 'Taylor' },
      } as any);

      jest.spyOn(prisma as any, '$transaction').mockImplementation(async (cb: any) => {
        return cb({
          quizInvitation: { update: jest.fn() },
          quizSessionParticipant: { upsert: jest.fn() },
          quizSession: { update: jest.fn() },
        });
      });

      jest.spyOn(sessionService, 'getSession').mockResolvedValue({
        session: { id: 'session-1' } as any,
        participants: [],
        invitations: [],
        isLocked: false,
        isParticipant: true,
        isCreator: false,
      });

      const res = await invitationService.acceptInvitation(2, 'invite-1');

      expect(res.success).toBe(true);
      expect(res.sessionId).toBe('session-1');
      expect(mockNotificationService.quizInvitationAccepted).toHaveBeenCalledWith(
        1,
        'Bob Taylor',
        'Yoruba Culture',
      );
      expect(mockNotificationGateway.sendQuizEvent).toHaveBeenCalledWith(
        [1],
        'quiz:invitation_accepted',
        expect.objectContaining({ invitationId: 'invite-1', recipientId: 2 }),
      );
    });

    it('successfully declines invitation and updates status', async () => {
      jest.spyOn(prisma.quizInvitation, 'findUnique').mockResolvedValue({
        id: 'invite-1',
        sessionId: 'session-1',
        quizTitle: 'Tech Trivia',
        senderId: 1,
        recipientId: 2,
        status: 'PENDING',
        recipient: { id: 2, username: 'bob', firstName: 'Bob' },
      } as any);

      const updateSpy = jest.spyOn(prisma.quizInvitation, 'update').mockResolvedValue({} as any);

      const res = await invitationService.declineInvitation(2, 'invite-1');

      expect(res.success).toBe(true);
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: 'invite-1' },
        data: { status: 'DECLINED' },
      });
      expect(mockNotificationService.quizInvitationDeclined).toHaveBeenCalledWith(
        1,
        'Bob',
        'Tech Trivia',
      );
    });
  });
});
