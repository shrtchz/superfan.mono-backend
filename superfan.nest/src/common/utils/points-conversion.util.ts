import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '../../prisma/prisma';

@Injectable()
export class PointsConversionUtil {
  constructor(private configService: ConfigService) {}

  private getEnvironmentRate(category: 'quiz' | 'ads' = 'quiz'): number {
    if (category === 'ads') {
      const configuredRate = Number(
        this.configService.get<string>('ADS_POINTS_TO_NAIRA_RATE'),
      );
      return Number.isFinite(configuredRate) && configuredRate > 0
        ? configuredRate
        : 200;
    }
    const configuredRate = Number(
      this.configService.get<string>('POINTS_TO_NAIRA_RATE'),
    );
    return Number.isFinite(configuredRate) && configuredRate > 0
      ? configuredRate
      : 1000;
  }

  private getSettingKey(category: 'quiz' | 'ads' = 'quiz'): string {
    return category === 'ads' ? 'adsPointsToNairaRate' : 'pointsToNairaRate';
  }

  async getConversionRateDetails(category: 'quiz' | 'ads' = 'quiz'): Promise<{
    rate: number;
    updatedAt: Date | null;
  }> {
    const key = this.getSettingKey(category);
    const setting = await prisma.platformSetting.findUnique({
      where: { key },
    });

    if (!setting) {
      return { rate: this.getEnvironmentRate(category), updatedAt: null };
    }

    const rate = Number(setting.value);
    if (!Number.isSafeInteger(rate) || rate <= 0) {
      throw new Error(`The stored ${category} points conversion rate is invalid`);
    }

    return { rate, updatedAt: setting.updatedAt };
  }

  async getAllConversionRatesDetails(): Promise<{
    rate: number;
    updatedAt: Date | null;
    quiz: { rate: number; updatedAt: Date | null };
    ads: { rate: number; updatedAt: Date | null };
  }> {
    const [quiz, ads] = await Promise.all([
      this.getConversionRateDetails('quiz'),
      this.getConversionRateDetails('ads'),
    ]);

    return {
      rate: quiz.rate,
      updatedAt: quiz.updatedAt,
      quiz,
      ads,
    };
  }

  async setConversionRate(
    rate: number,
    category: 'quiz' | 'ads' = 'quiz',
  ): Promise<{
    rate: number;
    updatedAt: Date;
    category?: string;
    quiz?: { rate: number; updatedAt: Date | null };
    ads?: { rate: number; updatedAt: Date | null };
  }> {
    if (!Number.isSafeInteger(rate) || rate <= 0) {
      throw new Error('The points conversion rate must be a positive integer');
    }

    const key = this.getSettingKey(category);
    const setting = await prisma.platformSetting.upsert({
      where: { key },
      create: { key, value: String(rate) },
      update: { value: String(rate) },
    });

    const all = await this.getAllConversionRatesDetails();

    return {
      rate: Number(setting.value),
      updatedAt: setting.updatedAt,
      category,
      quiz: all.quiz,
      ads: all.ads,
    };
  }

  /**
   * Convert points to Naira amount
   * Rate: POINTS_TO_NAIRA_RATE points = 1 Naira (or ADS_POINTS_TO_NAIRA_RATE for ads)
   */
  async pointsToNaira(points: number, category: 'quiz' | 'ads' = 'quiz'): Promise<number> {
    return points / (await this.getConversionRateDetails(category)).rate;
  }

  /**
   * Convert Naira amount to points
   * Rate: 1 Naira = POINTS_TO_NAIRA_RATE points (or ADS_POINTS_TO_NAIRA_RATE for ads)
   */
  async nairaToPoints(naira: number, category: 'quiz' | 'ads' = 'quiz'): Promise<number> {
    return naira * (await this.getConversionRateDetails(category)).rate;
  }

  /**
   * Get the current points-to-Naira conversion rate
   */
  async getConversionRate(category: 'quiz' | 'ads' = 'quiz'): Promise<number> {
    return (await this.getConversionRateDetails(category)).rate;
  }
}
