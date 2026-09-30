import {
  addLeaderboardInviteeFlags,
  addLeaderboardUsersWithoutActivity,
  sortLeaderboardByPosition,
  buildLiveQuizLeaderboardRows,
  calculateLeaderboardAccuracy,
  calculateCompletedQuizAccuracy,
  getLeaderboardDateFilter,
  normalizeLeaderboardTimeRange,
  normalizeLeaderboardView,
} from './quiz.service';

describe('calculateCompletedQuizAccuracy', () => {
  it('recalculates a stale zero from persisted quiz answers', () => {
    expect(
      calculateCompletedQuizAccuracy({
        accuracyPercent: 0,
        correctAnswers: 0,
        totalQuestions: 10,
        answers: [
          { selectedAnswer: 'A', isCorrect: true, answeredAt: '2026-09-01T10:00:00Z' },
          { selectedAnswer: 'B', isCorrect: true, answeredAt: '2026-09-01T10:01:00Z' },
          { selectedAnswer: 'C', isCorrect: false, answeredAt: '2026-09-01T10:02:00Z' },
        ],
      }),
    ).toBe(20);
  });

  it('preserves zero accuracy when every stored answer is incorrect', () => {
    expect(
      calculateCompletedQuizAccuracy({
        accuracyPercent: 0,
        correctAnswers: 0,
        totalQuestions: 10,
        answers: [
          { selectedAnswer: 'B', isCorrect: false, answeredAt: '2026-09-01T10:00:00Z' },
        ],
      }),
    ).toBe(0);
  });

  it('uses persisted correct-answer counts when answer details are unavailable', () => {
    expect(
      calculateCompletedQuizAccuracy({
        accuracyPercent: 0,
        correctAnswers: 3,
        totalQuestions: 10,
      }),
    ).toBe(30);
  });

  it('uses session leaderboard rows when historical answer JSON has timestamps but no grading flags', () => {
    expect(
      calculateCompletedQuizAccuracy(
        {
          accuracyPercent: 0,
          correctAnswers: 0,
          totalQuestions: 10,
          answers: [
            { selectedAnswer: 'A', answeredAt: '2026-09-01T10:00:00Z' },
            { selectedAnswer: 'B', answeredAt: '2026-09-01T10:01:00Z' },
            { selectedAnswer: 'C', answeredAt: '2026-09-01T10:02:00Z' },
          ],
        },
        [
          { earning: 400, selectedAnswer: 'A', correctAnswer: 'A' },
          { earning: 400, selectedAnswer: 'B', correctAnswer: 'B' },
          { earning: 0, selectedAnswer: 'C', correctAnswer: 'D' },
        ],
      ),
    ).toBe(20);
  });
});

describe('addLeaderboardUsersWithoutActivity', () => {
  it('adds empty entries for scoped users without changing active entries', () => {
    const activeEntry = {
      userId: '1',
      username: 'active-user',
      totalScore: 1200,
      rows: [{ quizId: 'quiz-1' }],
    };

    const entries = addLeaderboardUsersWithoutActivity([activeEntry], [
      { id: 1, username: 'active-user' },
      { id: 2, username: 'new-user' },
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toBe(activeEntry);
    expect(entries[1]).toEqual(
      expect.objectContaining({
        userId: '2',
        username: 'new-user',
        totalScore: null,
        totalEarning: 0,
        position: null,
        rows: [],
      }),
    );
  });

  it('returns an empty entry for every scoped user when no activity exists', () => {
    const entries = addLeaderboardUsersWithoutActivity([], [
      { id: 3, username: 'first-user' },
      { id: 4, username: 'second-user' },
    ]);

    expect(entries.map((entry) => entry.userId)).toEqual(['3', '4']);
    expect(entries.every((entry) => entry.rows.length === 0)).toBe(true);
  });
});

describe('sortLeaderboardByPosition', () => {
  it('orders users by rank and places users without a rank last', () => {
    const newestLowerRank = {
      userId: 'newer-user',
      position: 2,
      submittedAt: new Date('2026-09-30T12:00:00Z'),
    };
    const olderTopRank = {
      userId: 'top-user',
      position: 1,
      submittedAt: new Date('2026-09-01T12:00:00Z'),
    };
    const noActivity = { userId: 'inactive-user', position: null };

    expect(
      sortLeaderboardByPosition([newestLowerRank, noActivity, olderTopRank]),
    ).toEqual([olderTopRank, newestLowerRank, noActivity]);
  });
});

describe('addLeaderboardInviteeFlags', () => {
  it('marks active and inactive invitees for client-side filtering', () => {
    const entries = addLeaderboardInviteeFlags(
      [
        { userId: '1', rows: [{ quizId: 'quiz-1' }] },
        { userId: '2', rows: [] },
      ],
      [2],
    );

    expect(entries.map((entry) => entry.isInvitee)).toEqual([false, true]);
    expect(entries[1].rows).toEqual([]);
  });
});

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
