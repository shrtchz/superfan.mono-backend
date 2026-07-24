import { buildLiveQuizLeaderboardRows } from './quiz.service';

describe('buildLiveQuizLeaderboardRows', () => {
  it('includes quizzes with active participants even when no leaderboard rows exist yet', () => {
    const leaderboardEntries: Array<Record<string, unknown>> = [];
    const ongoingQuizzes = [
      {
        userId: 'user-1',
        quizIds: ['quiz-123'],
      },
    ];

    const rows = buildLiveQuizLeaderboardRows(leaderboardEntries, ongoingQuizzes as any[]);

    expect(rows).toEqual([
      expect.objectContaining({
        quizId: 'quiz-123',
        participants: 1,
        status: 'NONE',
      }),
    ]);
  });
});
