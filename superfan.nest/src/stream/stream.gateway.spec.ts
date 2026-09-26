import { StreamGateway } from './stream.gateway';
import { StreamingService } from './stream.service';
import { QuizService } from '../quiz/quiz.service';

describe('StreamGateway.fetchComments', () => {
  it('returns the underlying error when comment loading fails', async () => {
    const streamingService = {
      getStreamCommentsandReplies: jest.fn(),
    } as unknown as StreamingService;

    const gateway = new StreamGateway(streamingService, {} as QuizService);

    (streamingService.getStreamCommentsandReplies as jest.Mock).mockRejectedValue(
      new Error('DB unavailable'),
    );

    const result = await gateway.fetchComments(
      { streamId: '42', userId: '7' },
      { data: {}, handshake: { query: {} } } as any,
    );

    expect(result).toEqual({
      status: 'error',
      error: 'Failed to fetch comments: DB unavailable',
      comments: [],
    });
  });
});
