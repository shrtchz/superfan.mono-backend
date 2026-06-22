export function generateFiveUniqueRandomNumbers(min = 1, max = 9) {
  if (max - min + 1 < 6) {
    throw new Error("Range is too small for 6 unique numbers.");
  }

  const numbers = new Set<number>();

  while (numbers.size < 5) {
    const randomNumber =
      Math.floor(Math.random() * (max - min + 1)) + min;

    numbers.add(randomNumber);
  }

  // Convert array to single string like: 927819
  return [...numbers].join('');
}

export function getAccuracyBonus(correct: number, total: number): number {
  if (total <= 0) return 0;

  const accuracy = (correct / total) * 100;

  if (accuracy === 100) return 50;
  if (accuracy >= 95) return 25;
  if (accuracy >= 90) return 10;
  return 0;
}

export function getSpeedBonus(quizTime: string): number {
  const parts = String(quizTime).split(':').map(Number);
  const seconds =
    parts.length === 1 ? parts[0] : parts[0] * 60 + (parts[1] || 0);

  if (!Number.isFinite(seconds)) return 0;

  if (seconds < 120) return 50;
  if (seconds < 180) return 25;
  if (seconds < 300) return 10;
  return 0;
}

export function getStreakBonus(streakData?: { dailyStreak: number }): {
  streakBonus: number;
  dailyStreak: number;
} {
  const dailyStreak: number = streakData?.dailyStreak ?? 0;
  const streakBonus = Math.round((dailyStreak / 7) * 1000);

  return { streakBonus, dailyStreak };
}
