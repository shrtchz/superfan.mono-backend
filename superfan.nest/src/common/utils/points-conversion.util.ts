import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PointsConversionUtil {
  constructor(private configService: ConfigService) {}

  /**
   * Convert points to Naira amount
   * Rate: POINTS_TO_NAIRA_RATE points = 1 Naira
   * Default: 1000 points = 1 Naira
   */
  pointsToNaira(points: number): number {
    const rate = parseInt(this.configService.get<string>('POINTS_TO_NAIRA_RATE', '1000'), 10);
    return points / rate;
  }

  /**
   * Convert Naira amount to points
   * Rate: 1 Naira = POINTS_TO_NAIRA_RATE points
   * Default: 1 Naira = 1000 points
   */
  nairaToPoints(naira: number): number {
    const rate = parseInt(this.configService.get<string>('POINTS_TO_NAIRA_RATE', '1000'), 10);
    return naira * rate;
  }

  /**
   * Get the current points-to-Naira conversion rate
   */
  getConversionRate(): number {
    return parseInt(this.configService.get<string>('POINTS_TO_NAIRA_RATE', '1000'), 10);
  }
}