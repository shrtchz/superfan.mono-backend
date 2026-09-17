import { StreamingService } from './stream.service';
import { prisma } from '../prisma/prisma';

jest.mock('../prisma/prisma', () => ({
  prisma: {
    streamComment: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    commentLike: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    commentReport: {
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    userHistory: {
      create: jest.fn(),
    },
    stream: {
      findUnique: jest.fn(),
    },
    ongoingLiveQuiz: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  },
}));

describe('StreamingService unified comment tree', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('soft-deletes a comment subtree instead of only the root node', async () => {
    const service = Object.create(StreamingService.prototype) as StreamingService;
    (service as any).redis = {
      del: jest.fn().mockResolvedValue(undefined),
    };
    (service as any).logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    (service as any).elasticSearch = {
      deleteComment: jest.fn().mockResolvedValue(undefined),
    };

    (prisma.streamComment.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 10,
      streamId: 3,
      userId: 42,
      parentId: null,
      rootId: 10,
      replyToUserId: null,
      depth: 0,
      message: 'Root',
      likesCount: 0,
      reportsCount: 0,
      isDeleted: false,
      isPinned: false,
      isWinner: false,
      winAmount: null,
      createdAt: new Date('2026-07-30T10:00:00.000Z'),
      updatedAt: new Date('2026-07-30T10:00:00.000Z'),
    });
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([
      { id: 10 },
      { id: 77 },
    ]);
    (prisma.streamComment.updateMany as jest.Mock).mockResolvedValueOnce({ count: 2 });

    await service.deleteOwnStreamComment(10, 42);

    expect(prisma.streamComment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [10, 77] }, isDeleted: false },
      data: { isDeleted: true },
    });
    expect((service as any).elasticSearch.deleteComment).toHaveBeenCalledWith(10);
    expect((service as any).elasticSearch.deleteComment).toHaveBeenCalledWith(77);
  });

  it('creates nested replies in StreamComment with parent and root metadata', async () => {
    const service = Object.create(StreamingService.prototype) as StreamingService;
    (service as any).redis = {
      del: jest.fn().mockResolvedValue(undefined),
    };
    (service as any).logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    (service as any).elasticSearch = {
      indexComment: jest.fn().mockResolvedValue(undefined),
    };
    (service as any).notificationService = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };
    (service as any).assertStreamParticipation = jest.fn().mockResolvedValue(undefined);
    (service as any).isStreamModerator = jest.fn().mockResolvedValue(false);
    (service as any).hasSubmittedLiveQuizForStream = jest.fn().mockResolvedValue(true);
    (service as any).submitLiveQuizAnswerFromMessage = jest.fn();
    (service as any).getUserPublicProfile = jest.fn().mockResolvedValue({
      id: 99,
      displayName: 'Ridwan',
      avatarUrl: 'https://example.com/avatar.png',
      username: 'ridwan',
    });

    (prisma.streamComment.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 10,
      streamId: 3,
      userId: 42,
      parentId: null,
      rootId: 10,
      replyToUserId: null,
      depth: 0,
      message: 'Root',
      likesCount: 0,
      reportsCount: 0,
      isDeleted: false,
      isPinned: false,
      isWinner: false,
      winAmount: null,
      createdAt: new Date('2026-07-30T10:00:00.000Z'),
      updatedAt: new Date('2026-07-30T10:00:00.000Z'),
    });
    (prisma.streamComment.create as jest.Mock).mockResolvedValueOnce({
      id: 11,
      streamId: 3,
      userId: 99,
      parentId: 10,
      rootId: 10,
      replyToUserId: 42,
      depth: 1,
      message: 'Nested reply',
      likesCount: 0,
      reportsCount: 0,
      isDeleted: false,
      createdAt: new Date('2026-07-30T10:05:00.000Z'),
      updatedAt: new Date('2026-07-30T10:05:00.000Z'),
    });

    const result = await service.replyToComment(10, 'Nested reply', 99);

    expect(prisma.streamComment.create).toHaveBeenCalledWith({
      data: {
        streamId: 3,
        parentId: 10,
        rootId: 10,
        replyToUserId: 42,
        depth: 1,
        message: 'Nested reply',
        userId: 99,
        isDeleted: false,
      },
    });
    expect((service as any).elasticSearch.indexComment).toHaveBeenCalledWith({
      id: 11,
      streamId: 3,
      content: 'Nested reply',
      parentId: '10',
      createdAt: new Date('2026-07-30T10:05:00.000Z'),
    });
    expect(result.parentCommentId).toBe(10);
    expect(result.rootCommentId).toBe(10);
    expect(result.depth).toBe(1);
  });
});
