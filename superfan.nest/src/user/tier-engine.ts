export type TierName = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Legend';

export type TierState = 'Unlocked' | 'Current' | 'Locked';

export type StrengthBand = 'Strong' | 'Developing' | 'Needs work';

export interface TierDefinition {
  name: TierName;
  threshold: number;
  color: string;
  bg: string;
  border: string;
  text: string;
}

export const TIER_CONFIG: readonly TierDefinition[] = [
  {
    name: 'Bronze',
    threshold: 10_000,
    color: '#CD7F32',
    bg: '#FDF8F6',
    border: '#CD7F32',
    text: '#8C5A2B',
  },
  {
    name: 'Silver',
    threshold: 50_000,
    color: '#A7AFB7',
    bg: '#F9FAFB',
    border: '#A7AFB7',
    text: '#6B7280',
  },
  {
    name: 'Gold',
    threshold: 100_000,
    color: '#F0B429',
    bg: '#FFFBEA',
    border: '#F0B429',
    text: '#B7791F',
  },
  {
    name: 'Platinum',
    threshold: 250_000,
    color: '#4682B4',
    bg: '#EEF4FA',
    border: '#4682B4',
    text: '#2F5D8A',
  },
  {
    name: 'Legend',
    threshold: 500_000,
    color: 'legend-gradient',
    bg: '#F5F0FF',
    border: '#7C3AED',
    text: '#5B21B6',
  },
] as const;

export interface TierCardState {
  name: TierName;
  threshold: number;
  color: string;
  state: TierState;
}

export interface TierStatisticsResponse {
  lifetimePoints: number;
  cashValue: number;
  currentTier: {
    name: TierName;
    threshold: number;
    color: string;
  } | null;
  nextTier: {
    name: TierName;
    threshold: number;
    color: string;
  } | null;
  pointsNeeded: number;
  progressFraction: number;
  tiers: TierCardState[];
}

export function calculateCashValue(lifetimePoints: number): number {
  const safePoints = Math.max(0, Math.floor(Number(lifetimePoints) || 0));
  return Number((safePoints / 1000).toFixed(2));
}

export function calculateTierStatistics(lifetimePointsRaw: number): TierStatisticsResponse {
  const lifetimePoints = Math.max(0, Math.floor(Number(lifetimePointsRaw) || 0));
  const cashValue = calculateCashValue(lifetimePoints);

  // Find the highest tier reached
  const currentTierDef = [...TIER_CONFIG]
    .reverse()
    .find((tier) => lifetimePoints >= tier.threshold) ?? null;

  let nextTierDef: TierDefinition | null = null;
  if (!currentTierDef) {
    nextTierDef = TIER_CONFIG[0]; // Progress towards Bronze
  } else if (currentTierDef.name !== 'Legend') {
    const currentIndex = TIER_CONFIG.findIndex((t) => t.name === currentTierDef.name);
    nextTierDef = TIER_CONFIG[currentIndex + 1] ?? null;
  }

  let pointsNeeded = 0;
  let progressFraction = 0;

  if (nextTierDef) {
    pointsNeeded = Math.max(0, nextTierDef.threshold - lifetimePoints);
    progressFraction = Math.min(1, Math.max(0, lifetimePoints / nextTierDef.threshold));
  } else {
    // Legend tier reached
    pointsNeeded = 0;
    progressFraction = 1.0;
  }

  const tiers: TierCardState[] = TIER_CONFIG.map((tier) => {
    let state: TierState = 'Locked';
    if (currentTierDef && tier.name === currentTierDef.name) {
      state = 'Current';
    } else if (lifetimePoints >= tier.threshold) {
      state = 'Unlocked';
    } else {
      state = 'Locked';
    }

    return {
      name: tier.name,
      threshold: tier.threshold,
      color: tier.color,
      state,
    };
  });

  return {
    lifetimePoints,
    cashValue,
    currentTier: currentTierDef
      ? {
          name: currentTierDef.name,
          threshold: currentTierDef.threshold,
          color: currentTierDef.color,
        }
      : null,
    nextTier: nextTierDef
      ? {
          name: nextTierDef.name,
          threshold: nextTierDef.threshold,
          color: nextTierDef.color,
        }
      : null,
    pointsNeeded,
    progressFraction: Number(progressFraction.toFixed(4)),
    tiers,
  };
}

export function getStrengthBand(accuracy: number): StrengthBand {
  if (accuracy >= 75) return 'Strong';
  if (accuracy >= 50) return 'Developing';
  return 'Needs work';
}
