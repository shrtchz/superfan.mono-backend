import { StreamingService } from './stream.service';
import { prisma } from '../prisma/prisma';

jest.mock('../prisma/prisma', () => ({
  prisma: {
    streamComment: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    commentReply: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    commentLike: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    commentReplyLike: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    commentReport: {
      create: jest.fn(),
    },
    commentReplyReport: {
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
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
  },
}));

describe('StreamingService comment deletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('soft-deletes a root comment and its replies instead of hard deleting them', async () => {
    const service = Object.create(StreamingService.prototype) as StreamingService;
    (service as any).redis = { del: jest.fn().mockResolvedValue(undefined) };
    (service as any).logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };

    (prisma.streamComment.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 10,
      streamId: 3,
      userId: 42,
      isDeleted: false,
    });
    (prisma.commentReply.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 77, commentId: 10, userId: 7, isDeleted: false },
    ]);
    (prisma.commentReply.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
    (prisma.streamComment.update as jest.Mock).mockResolvedValueOnce({
      id: 10,
      streamId: 3,
      userId: 42,
      isDeleted: true,
    });

    await service.deleteOwnStreamComment(10, 42);

    expect(prisma.commentReply.updateMany).toHaveBeenCalledWith({
      where: { commentId: 10, isDeleted: false },
      data: { isDeleted: true },
    });
    expect(prisma.streamComment.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { isDeleted: true },
    });
  });
});
