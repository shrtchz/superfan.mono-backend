import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PointsConversionUtil {
  constructor(private configService: ConfigService) {}

  private getRate(): number {
    const configuredRate = Number(
      this.configService.get<string>('POINTS_TO_NAIRA_RATE'),
    );
    return Number.isFinite(configuredRate) && configuredRate > 0
      ? configuredRate
      : 1000;
  }

  /**
   * Convert points to Naira amount
   * Rate: POINTS_TO_NAIRA_RATE points = 1 Naira
   * Default: 1000 points = 1 Naira
   */
  pointsToNaira(points: number): number {
    return points / this.getRate();
  }

  /**
   * Convert Naira amount to points
   * Rate: 1 Naira = POINTS_TO_NAIRA_RATE points
   * Default: 1 Naira = 1000 points
   */
  nairaToPoints(naira: number): number {
    return naira * this.getRate();
  }

  /**
   * Get the current points-to-Naira conversion rate
   */
  getConversionRate(): number {
    return this.getRate();
  }
}