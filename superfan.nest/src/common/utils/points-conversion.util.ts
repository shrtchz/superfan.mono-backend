import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '../../prisma/prisma';

@Injectable()
export class PointsConversionUtil {
  constructor(private configService: ConfigService) {}

  private getEnvironmentRate(): number {
    const configuredRate = Number(
      this.configService.get<string>('POINTS_TO_NAIRA_RATE'),
    );
    return Number.isFinite(configuredRate) && configuredRate > 0
      ? configuredRate
      : 1000;
  }

  async getConversionRateDetails(): Promise<{
    rate: number;
    updatedAt: Date | null;
  }> {
    const setting = await prisma.platformSetting.findUnique({
      where: { key: 'pointsToNairaRate' },
    });

    if (!setting) {
      return { rate: this.getEnvironmentRate(), updatedAt: null };
    }

    const rate = Number(setting.value);
    if (!Number.isSafeInteger(rate) || rate <= 0) {
      throw new Error('The stored points conversion rate is invalid');
    }

    return { rate, updatedAt: setting.updatedAt };
  }

  async setConversionRate(rate: number): Promise<{
    rate: number;
    updatedAt: Date;
  }> {
    if (!Number.isSafeInteger(rate) || rate <= 0) {
      throw new Error('The points conversion rate must be a positive integer');
    }

    const setting = await prisma.platformSetting.upsert({
      where: { key: 'pointsToNairaRate' },
      create: { key: 'pointsToNairaRate', value: String(rate) },
      update: { value: String(rate) },
    });

    return { rate: Number(setting.value), updatedAt: setting.updatedAt };
  }

  /**
   * Convert points to Naira amount
   * Rate: POINTS_TO_NAIRA_RATE points = 1 Naira
   * Default: 1000 points = 1 Naira
   */
  async pointsToNaira(points: number): Promise<number> {
    return points / (await this.getConversionRateDetails()).rate;
  }

  /**
   * Convert Naira amount to points
   * Rate: 1 Naira = POINTS_TO_NAIRA_RATE points
   * Default: 1 Naira = 1000 points
   */
  async nairaToPoints(naira: number): Promise<number> {
    return naira * (await this.getConversionRateDetails()).rate;
  }

  /**
   * Get the current points-to-Naira conversion rate
   */
  async getConversionRate(): Promise<number> {
    return (await this.getConversionRateDetails()).rate;
  }
}