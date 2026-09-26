import {
  buildLiveQuizLeaderboardRows,
  calculateLeaderboardAccuracy,
  getLeaderboardDateFilter,
  normalizeLeaderboardTimeRange,
  normalizeLeaderboardView,
} from './quiz.service';

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

    expect(rows).toEqual(
      expect.objectContaining({
        totalQuizzes: 1,
        totalParticipants: 1,
        leaderboard: [
          expect.objectContaining({
            quizId: 'quiz-123',
            participants: 1,
            status: 'NONE',
          }),
        ],
      }),
    );
  });
});

describe('normalizeLeaderboardTimeRange', () => {
  it('normalizes valid time ranges', () => {
    expect(normalizeLeaderboardTimeRange('Today')).toBe('today');
    expect(normalizeLeaderboardTimeRange('Weekly')).toBe('weekly');
    expect(normalizeLeaderboardTimeRange('monthly')).toBe('monthly');
    expect(normalizeLeaderboardTimeRange('All')).toBe('all');
  });

  it('falls back to all for unknown or empty values', () => {
    expect(normalizeLeaderboardTimeRange(undefined)).toBe('all');
    expect(normalizeLeaderboardTimeRange('')).toBe('all');
    expect(normalizeLeaderboardTimeRange('yearly')).toBe('all');
  });
});

describe('normalizeLeaderboardView', () => {
  it('normalizes the three supported views', () => {
    expect(normalizeLeaderboardView('Leaderboard')).toBe('leaderboard');
    expect(normalizeLeaderboardView('My Invitees')).toBe('my-invitees');
    expect(normalizeLeaderboardView('my_invitees')).toBe('my-invitees');
    expect(normalizeLeaderboardView('My Score')).toBe('my-score');
    expect(normalizeLeaderboardView('My Stats')).toBe('my-score');
  });

  it('falls back to leaderboard for unknown values', () => {
    expect(normalizeLeaderboardView(undefined)).toBe('leaderboard');
    expect(normalizeLeaderboardView('weekly')).toBe('leaderboard');
  });
});

describe('getLeaderboardDateFilter', () => {
  const now = new Date('2026-09-21T12:00:00.000Z');

  it('returns an empty filter for all', () => {
    expect(getLeaderboardDateFilter('all', now)).toEqual({});
  });

  it('builds a start-of-day filter for today', () => {
    const filter = getLeaderboardDateFilter('today', now);
    expect(filter.gte).toBeInstanceOf(Date);
    expect(filter.gte!.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(filter.gte!.getHours()).toBe(0);
  });

  it('builds a 7-day filter for weekly', () => {
    const filter = getLeaderboardDateFilter('weekly', now);
    const expected = new Date(now);
    expected.setHours(0, 0, 0, 0);
    expected.setDate(expected.getDate() - 7);
    expect(filter.gte!.getTime()).toBe(expected.getTime());
  });

  it('builds a 30-day filter for monthly', () => {
    const filter = getLeaderboardDateFilter('monthly', now);
    const expected = new Date(now);
    expected.setHours(0, 0, 0, 0);
    expected.setDate(expected.getDate() - 30);
    expect(filter.gte!.getTime()).toBe(expected.getTime());
  });
});

describe('calculateLeaderboardAccuracy', () => {
  it('returns null when no comparable rows exist', () => {
    expect(calculateLeaderboardAccuracy([])).toBeNull();
    expect(
      calculateLeaderboardAccuracy([
        { selectedAnswer: null, correctAnswer: null },
      ]),
    ).toBeNull();
  });

  it('computes rounded percentage from correct answers', () => {
    const rows = [
      { selectedAnswer: 'A', correctAnswer: 'A' },
      { selectedAnswer: 'B', correctAnswer: 'A' },
      { selectedAnswer: 'C', correctAnswer: 'C' },
    ];
    expect(calculateLeaderboardAccuracy(rows)).toBe(67);
  });

  it('ignores rows without both answers', () => {
    const rows = [
      { selectedAnswer: 'A', correctAnswer: 'A' },
      { selectedAnswer: 'B', correctAnswer: 'A' },
      { selectedAnswer: null, correctAnswer: 'C' },
    ];
    expect(calculateLeaderboardAccuracy(rows)).toBe(50);
  });
});
