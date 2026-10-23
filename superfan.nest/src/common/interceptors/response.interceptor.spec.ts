import { InternalServerErrorException } from '@nestjs/common';
import { failureResponse } from './response.interceptor';

describe('failureResponse', () => {
  it('includes the full serialized error message for nested prisma errors', () => {
    const error = {
      message: 'Database write failed',
      code: 'P2002',
      meta: { target: ['youtubeVideoId'] },
      cause: { originalMessage: 'duplicate key value violates unique constraint "Podcast_youtubeVideoId_key"' },
    };

    const result = failureResponse(error);

    expect(result).toBeInstanceOf(InternalServerErrorException);
    expect(result.getResponse()).toMatchObject({
      message: expect.stringContaining('duplicate key value violates unique constraint'),
      error: expect.any(String),
    });
  });
});
