import {
  calculateTierStatistics,
  calculateCashValue,
  getStrengthBand,
  TIER_CONFIG,
} from './tier-engine';

describe('TierEngine - Tier Calculation & Progression', () => {
  describe('Cash Value Calculation (1,000 PTS = ₦1)', () => {
    it('formats cash value correctly for standard and fractional amounts', () => {
      expect(calculateCashValue(0)).toBe(0);
      expect(calculateCashValue(1000)).toBe(1.0);
      expect(calculateCashValue(124500)).toBe(124.5);
      expect(calculateCashValue(124555)).toBe(124.56);
      expect(calculateCashValue(500000)).toBe(500.0);
      expect(calculateCashValue(-100)).toBe(0);
    });
  });

  describe('Tier Thresholds and Edge Cases', () => {
    it('handles 0 PTS: all 5 tiers locked, no current tier, targets Bronze', () => {
      const stats = calculateTierStatistics(0);
      expect(stats.lifetimePoints).toBe(0);
      expect(stats.cashValue).toBe(0);
      expect(stats.currentTier).toBeNull();
      expect(stats.nextTier).toEqual({
        name: 'Bronze',
        threshold: 10000,
        color: '#CD7F32',
      });
      expect(stats.pointsNeeded).toBe(10000);
      expect(stats.progressFraction).toBe(0);
      expect(stats.tiers.every((t) => t.state === 'Locked')).toBe(true);
    });

    it('handles 5,000 PTS: below Bronze', () => {
      const stats = calculateTierStatistics(5000);
      expect(stats.currentTier).toBeNull();
      expect(stats.nextTier?.name).toBe('Bronze');
      expect(stats.pointsNeeded).toBe(5000);
      expect(stats.progressFraction).toBe(0.5);
      expect(stats.tiers.every((t) => t.state === 'Locked')).toBe(true);
    });

    it('handles 9,999 PTS: just below Bronze threshold', () => {
      const stats = calculateTierStatistics(9999);
      expect(stats.currentTier).toBeNull();
      expect(stats.nextTier?.name).toBe('Bronze');
      expect(stats.pointsNeeded).toBe(1);
      expect(stats.progressFraction).toBe(0.9999);
      expect(stats.tiers.every((t) => t.state === 'Locked')).toBe(true);
    });

    it('handles exactly 10,000 PTS: Bronze becomes Current', () => {
      const stats = calculateTierStatistics(10000);
      expect(stats.currentTier?.name).toBe('Bronze');
      expect(stats.nextTier?.name).toBe('Silver');
      expect(stats.pointsNeeded).toBe(40000);
      expect(stats.progressFraction).toBe(0.2);

      const bronze = stats.tiers.find((t) => t.name === 'Bronze');
      expect(bronze?.state).toBe('Current');
      const silver = stats.tiers.find((t) => t.name === 'Silver');
      expect(silver?.state).toBe('Locked');
    });

    it('handles 49,999 PTS: just below Silver threshold', () => {
      const stats = calculateTierStatistics(49999);
      expect(stats.currentTier?.name).toBe('Bronze');
      expect(stats.nextTier?.name).toBe('Silver');
      expect(stats.pointsNeeded).toBe(1);
      expect(stats.tiers.find((t) => t.name === 'Bronze')?.state).toBe('Current');
      expect(stats.tiers.find((t) => t.name === 'Silver')?.state).toBe('Locked');
    });

    it('handles exactly 50,000 PTS: Silver becomes Current, Bronze is Unlocked', () => {
      const stats = calculateTierStatistics(50000);
      expect(stats.currentTier?.name).toBe('Silver');
      expect(stats.nextTier?.name).toBe('Gold');
      expect(stats.pointsNeeded).toBe(50000);
      expect(stats.progressFraction).toBe(0.5);

      expect(stats.tiers.find((t) => t.name === 'Bronze')?.state).toBe('Unlocked');
      expect(stats.tiers.find((t) => t.name === 'Silver')?.state).toBe('Current');
      expect(stats.tiers.find((t) => t.name === 'Gold')?.state).toBe('Locked');
    });

    it('handles exactly 100,000 PTS: Gold becomes Current', () => {
      const stats = calculateTierStatistics(100000);
      expect(stats.currentTier?.name).toBe('Gold');
      expect(stats.nextTier?.name).toBe('Platinum');
      expect(stats.pointsNeeded).toBe(150000);
      expect(stats.progressFraction).toBe(0.4);

      expect(stats.tiers.find((t) => t.name === 'Bronze')?.state).toBe('Unlocked');
      expect(stats.tiers.find((t) => t.name === 'Silver')?.state).toBe('Unlocked');
      expect(stats.tiers.find((t) => t.name === 'Gold')?.state).toBe('Current');
      expect(stats.tiers.find((t) => t.name === 'Platinum')?.state).toBe('Locked');
    });

    it('handles 124,500 PTS: user specification example', () => {
      const stats = calculateTierStatistics(124500);
      expect(stats.lifetimePoints).toBe(124500);
      expect(stats.cashValue).toBe(124.5);
      expect(stats.currentTier?.name).toBe('Gold');
      expect(stats.currentTier?.color).toBe('#F0B429');
      expect(stats.nextTier?.name).toBe('Platinum');
      expect(stats.nextTier?.threshold).toBe(250000);
      expect(stats.nextTier?.color).toBe('#4682B4');
      expect(stats.pointsNeeded).toBe(125500);
      expect(stats.progressFraction).toBe(0.498);

      expect(stats.tiers.find((t) => t.name === 'Bronze')?.state).toBe('Unlocked');
      expect(stats.tiers.find((t) => t.name === 'Silver')?.state).toBe('Unlocked');
      expect(stats.tiers.find((t) => t.name === 'Gold')?.state).toBe('Current');
      expect(stats.tiers.find((t) => t.name === 'Platinum')?.state).toBe('Locked');
      expect(stats.tiers.find((t) => t.name === 'Legend')?.state).toBe('Locked');
    });

    it('handles exactly 250,000 PTS: Platinum becomes Current', () => {
      const stats = calculateTierStatistics(250000);
      expect(stats.currentTier?.name).toBe('Platinum');
      expect(stats.nextTier?.name).toBe('Legend');
      expect(stats.pointsNeeded).toBe(250000);
      expect(stats.progressFraction).toBe(0.5);

      expect(stats.tiers.find((t) => t.name === 'Gold')?.state).toBe('Unlocked');
      expect(stats.tiers.find((t) => t.name === 'Platinum')?.state).toBe('Current');
      expect(stats.tiers.find((t) => t.name === 'Legend')?.state).toBe('Locked');
    });

    it('handles exactly 500,000 PTS: Legend becomes Current, no next tier', () => {
      const stats = calculateTierStatistics(500000);
      expect(stats.currentTier?.name).toBe('Legend');
      expect(stats.nextTier).toBeNull();
      expect(stats.pointsNeeded).toBe(0);
      expect(stats.progressFraction).toBe(1.0);

      expect(stats.tiers.find((t) => t.name === 'Bronze')?.state).toBe('Unlocked');
      expect(stats.tiers.find((t) => t.name === 'Silver')?.state).toBe('Unlocked');
      expect(stats.tiers.find((t) => t.name === 'Gold')?.state).toBe('Unlocked');
      expect(stats.tiers.find((t) => t.name === 'Platinum')?.state).toBe('Unlocked');
      expect(stats.tiers.find((t) => t.name === 'Legend')?.state).toBe('Current');
    });

    it('handles above 500,000 PTS (e.g. 750,000 PTS): Legend remains Current, progress bar hidden', () => {
      const stats = calculateTierStatistics(750000);
      expect(stats.currentTier?.name).toBe('Legend');
      expect(stats.nextTier).toBeNull();
      expect(stats.pointsNeeded).toBe(0);
      expect(stats.progressFraction).toBe(1.0);
      expect(stats.tiers.filter((t) => t.state === 'Unlocked').length).toBe(4);
      expect(stats.tiers.find((t) => t.name === 'Legend')?.state).toBe('Current');
    });

    it('handles negative or invalid values gracefully', () => {
      const stats = calculateTierStatistics(-500);
      expect(stats.lifetimePoints).toBe(0);
      expect(stats.currentTier).toBeNull();
      expect(stats.nextTier?.name).toBe('Bronze');
    });
  });

  describe('Strength Bands Classification', () => {
    it('classifies boundaries correctly', () => {
      expect(getStrengthBand(100)).toBe('Strong');
      expect(getStrengthBand(75)).toBe('Strong');
      expect(getStrengthBand(74)).toBe('Developing');
      expect(getStrengthBand(50)).toBe('Developing');
      expect(getStrengthBand(49)).toBe('Needs work');
      expect(getStrengthBand(0)).toBe('Needs work');
    });
  });
});
