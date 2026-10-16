/**
 * AD PLACEMENT & PRICING LOGIC (0-User Launch Strategy)
 */

export type PlacementType =
  | 'QUIZ_AD_Q1'
  | 'MID_QUIZ_AD'
  | 'POST_QUIZ_AD'
  | 'PRE_QUIZ_AD'
  | 'SPONSORED_QUESTIONS';

export interface PlacementFormatRule {
  placementType: PlacementType;
  placementName: string;
  description: string;
  durationSec: number;
  skipAllowed: boolean;
  skipAfterSec: number;
  pricingModel: 'CPM' | 'CPA' | 'SPONSORED_BLOCKS';
  rate: number;
  rateUnit: string;
  guaranteedDailyUnits: number;
  unitType: string;
  pointsAwardActive: boolean;
  pointsAwardAmount: number;
  baseUnitQuestions?: number;
}

export interface EstimateAdCostInput {
  placementType: string;
  days?: number;
  runContinuously?: boolean;
  questionBlocks?: number;
  customUnits?: number;
  ageRange?: string;
}

export interface PricingSummary {
  model: string;
  rate: number;
  rateUnit: string;
  guaranteedDailyImpressions: number;
  guaranteedDailyViews: number;
  dailyFee: number;
  days: number;
  totalFee: number;
  currency: string;
  questionBlocks?: number;
  questionsPerBlock?: number;
}

export interface ReachEstimationSummary {
  mode: string;
  estimatedDailyReach: number;
  estimatedTotalReach: number;
  guaranteedDailyImpressions: number;
  guaranteedTotalImpressions: number;
  matchingUserCount?: number;
  targetAgeRange?: string;
  notice: string;
}

export interface EstimateAdCostResult {
  placementType: PlacementType;
  placementName: string;
  formatRules: PlacementFormatRule;
  pricing: PricingSummary;
  reachEstimation: ReachEstimationSummary;
}

export class AdPricingUtil {
  public static resolvePlacement(placementInput?: string): PlacementFormatRule {
    const normalized = (placementInput || '').trim().toUpperCase();

    switch (normalized) {
      case 'QUIZ_AD_Q1':
      case 'QUIZ_AD':
      case 'FIRST_QUARTER':
      case 'Q1':
      case 'QUIZ_AD_1ST_QUARTER':
        return {
          placementType: 'QUIZ_AD_Q1',
          placementName: 'Quiz Ad (1st Quarter)',
          description: '30s | Non-skippable | CPM Model (Pre-set)',
          durationSec: 30,
          skipAllowed: false,
          skipAfterSec: 0,
          pricingModel: 'CPM',
          rate: 3000,
          rateUnit: 'per 1,000 impressions',
          guaranteedDailyUnits: 5000,
          unitType: 'Impressions',
          pointsAwardActive: false,
          pointsAwardAmount: 0,
        };

      case 'MID_QUIZ_AD':
      case 'MID_QUIZ':
      case 'QUIZ_MIDPOINT':
      case 'MIDPOINT':
      case 'AFTER_2ND_QUARTER':
      case 'Q2_MID':
        return {
          placementType: 'MID_QUIZ_AD',
          placementName: 'Mid-Quiz Ad (After 2nd Quarter)',
          description: '15s | Skip after 5s | CPM Model (Pre-set) | Points Award Logic Active',
          durationSec: 15,
          skipAllowed: true,
          skipAfterSec: 5,
          pricingModel: 'CPM',
          rate: 2500,
          rateUnit: 'per 1,000 impressions',
          guaranteedDailyUnits: 5000,
          unitType: 'Impressions',
          pointsAwardActive: true,
          pointsAwardAmount: 200,
        };

      case 'POST_QUIZ_AD':
      case 'POST_QUIZ':
      case 'BEFORE_RESULTS':
      case 'POST_RESULTS':
        return {
          placementType: 'POST_QUIZ_AD',
          placementName: 'Post-Quiz Ad (Before Results)',
          description: '20s | Skip after 5s | CPA Model (Pre-set)',
          durationSec: 20,
          skipAllowed: true,
          skipAfterSec: 5,
          pricingModel: 'CPA',
          rate: 150,
          rateUnit: 'per view (NGN 150)',
          guaranteedDailyUnits: 5000,
          unitType: 'Views',
          pointsAwardActive: false,
          pointsAwardAmount: 0,
        };

      case 'PRE_QUIZ_AD':
      case 'PRE_QUIZ':
      case 'AFTER_RESULTS':
      case 'QUIZ_END':
        return {
          placementType: 'PRE_QUIZ_AD',
          placementName: 'Pre-Quiz Ad (After Results)',
          description: '20s | Skip after 5s | CPA Model (Pre-set)',
          durationSec: 20,
          skipAllowed: true,
          skipAfterSec: 5,
          pricingModel: 'CPA',
          rate: 150,
          rateUnit: 'per view (NGN 150)',
          guaranteedDailyUnits: 5000,
          unitType: 'Views',
          pointsAwardActive: false,
          pointsAwardAmount: 0,
        };

      case 'SPONSORED_QUESTIONS':
      case 'SPONSORED_BLOCKS':
      case 'NATIVE_QUESTIONS':
      case 'SPONSORED':
        return {
          placementType: 'SPONSORED_QUESTIONS',
          placementName: 'Sponsored Questions',
          description: 'Native Integration | Base Unit: Blocks of 25 Questions',
          durationSec: 0,
          skipAllowed: false,
          skipAfterSec: 0,
          pricingModel: 'SPONSORED_BLOCKS',
          rate: 25000,
          rateUnit: 'per 25-question block',
          guaranteedDailyUnits: 0,
          unitType: 'Blocks',
          pointsAwardActive: false,
          pointsAwardAmount: 0,
          baseUnitQuestions: 25,
        };

      default:
        return {
          placementType: 'MID_QUIZ_AD',
          placementName: 'Mid-Quiz Ad (After 2nd Quarter)',
          description: '15s | Skip after 5s | CPM Model (Pre-set) | Points Award Logic Active',
          durationSec: 15,
          skipAllowed: true,
          skipAfterSec: 5,
          pricingModel: 'CPM',
          rate: 2500,
          rateUnit: 'per 1,000 impressions',
          guaranteedDailyUnits: 5000,
          unitType: 'Impressions',
          pointsAwardActive: true,
          pointsAwardAmount: 200,
        };
    }
  }

  public static estimate(input: EstimateAdCostInput): EstimateAdCostResult {
    const rule = this.resolvePlacement(input.placementType);
    let days = input.days || 1;
    if (input.runContinuously) {
      days = 1;
    }

    let dailyFee = 0;
    let totalFee = 0;
    let guaranteedDailyImp = 0;
    let guaranteedDailyViews = 0;

    switch (rule.pricingModel) {
      case 'CPM':
        guaranteedDailyImp = input.customUnits || rule.guaranteedDailyUnits;
        dailyFee = Math.round((guaranteedDailyImp / 1000) * rule.rate);
        totalFee = dailyFee * days;
        break;

      case 'CPA':
        guaranteedDailyViews = input.customUnits || rule.guaranteedDailyUnits;
        dailyFee = guaranteedDailyViews * rule.rate;
        totalFee = dailyFee * days;
        break;

      case 'SPONSORED_BLOCKS':
        const blocks = Math.max(1, input.questionBlocks || 1);
        totalFee = blocks * rule.rate;
        dailyFee = totalFee;
        break;
    }

    let dailyReach = 5000;
    if (rule.pricingModel === 'SPONSORED_BLOCKS') {
      dailyReach = Math.max(1, input.questionBlocks || 1) * 25;
    } else if (guaranteedDailyImp > 0) {
      dailyReach = guaranteedDailyImp;
    } else if (guaranteedDailyViews > 0) {
      dailyReach = guaranteedDailyViews;
    }

    const totalReach = rule.pricingModel === 'SPONSORED_BLOCKS' ? dailyReach : dailyReach * days;

    const targetAgeRange = input.ageRange || '18-35';
    let demographicFactor = 0.75;
    switch (targetAgeRange) {
      case '18-24':
        demographicFactor = 0.42;
        break;
      case '18-35':
        demographicFactor = 0.77;
        break;
      case '25-45':
        demographicFactor = 0.50;
        break;
      case '45+':
        demographicFactor = 0.08;
        break;
      default:
        demographicFactor = 1.00;
        break;
    }

    const matchingUserCount = Math.round(145000 * demographicFactor);

    return {
      placementType: rule.placementType,
      placementName: rule.placementName,
      formatRules: rule,
      pricing: {
        model: rule.pricingModel,
        rate: rule.rate,
        rateUnit: rule.rateUnit,
        guaranteedDailyImpressions: guaranteedDailyImp,
        guaranteedDailyViews: guaranteedDailyViews,
        dailyFee,
        days,
        totalFee,
        currency: 'NGN',
        questionBlocks: input.questionBlocks,
        questionsPerBlock: rule.baseUnitQuestions,
      },
      reachEstimation: {
        mode: 'SYSTEM_DEMOGRAPHIC_MATCHING',
        estimatedDailyReach: dailyReach,
        estimatedTotalReach: totalReach,
        guaranteedDailyImpressions: guaranteedDailyImp,
        guaranteedTotalImpressions: guaranteedDailyImp * days,
        matchingUserCount,
        targetAgeRange,
        notice: '',
      },
    };
  }
}
