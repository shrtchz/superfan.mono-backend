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

export function getSpeedBonus(quizTime: string | number): number {
  const raw = typeof quizTime === 'number' ? quizTime : String(quizTime).trim();
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return 0;
    if (raw < 120) return 50;
    if (raw < 180) return 25;
    if (raw < 300) return 10;
    return 0;
  }

  const parts = raw.split(':').map(Number);
  const seconds = parts.length === 1 ? parts[0] : parts[0] * 60 + (parts[1] || 0);

  if (!Number.isFinite(seconds) || seconds < 0) return 0;

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

export function formatSecondsToMMSS(value: string | number | null | undefined): string {
  if (value == null) return "0:00";
  const raw = String(value).trim();
  if (!raw) return "0:00";
  // If already in MM:SS form, return as-is
  if (raw.includes(':')) return raw;
  const secs = Number(raw);
  if (!Number.isFinite(secs) || secs < 0) return raw;
  const minutes = Math.floor(secs / 60);
  const seconds = secs % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
