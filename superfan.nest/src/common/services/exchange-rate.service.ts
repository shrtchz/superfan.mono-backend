import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);
  private readonly COINGECKO_API_URL = 'https://api.coingecko.com/api/v3';
  private rateCache = new Map<string, { rate: number; timestamp: number }>();
  private readonly CACHE_DURATION_MS = 3600000; // 1 hour

  constructor(private readonly httpService: HttpService) {}

  /**
   * Fetches NGN to USDC/USDT conversion rates from Coingecko
   * Falls back to config value if API fails
   */
  async getNairaToUSDCRate(fallbackRate: number = 1600): Promise<number> {
    return this.getRate('usdc', fallbackRate);
  }

  async getNairaToUSDTRate(fallbackRate: number = 1600): Promise<number> {
    return this.getRate('usdt', fallbackRate);
  }

  /**
   * Generic method to fetch currency conversion rates
   * @param currency - The target currency (e.g., 'usdc', 'usdt')
   * @param fallbackRate - Fallback rate if API call fails
   * @returns Exchange rate (NGN per 1 unit of target currency)
   */
  private async getRate(currency: string, fallbackRate: number): Promise<number> {
    const cacheKey = currency.toLowerCase();

    // Check cache
    const cached = this.rateCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION_MS) {
      this.logger.debug(`Using cached rate for ${currency}: ${cached.rate}`);
      return cached.rate;
    }

    try {
      // Map common symbol to Coingecko ID
      const coinId = this.getCoinId(currency);
      if (!coinId) {
        this.logger.warn(`Unknown currency: ${currency}, using fallback rate: ${fallbackRate}`);
        return fallbackRate;
      }

      // Fetch from Coingecko
      const response = await firstValueFrom(
        this.httpService.get(`${this.COINGECKO_API_URL}/simple/price`, {
          params: {
            ids: coinId,
            vs_currencies: 'ngn',
          },
        }),
      );

      const rate = response.data?.[coinId]?.ngn;

      if (!rate) {
        this.logger.warn(
          `No rate found for ${currency} in Coingecko response, using fallback: ${fallbackRate}`,
        );
        return fallbackRate;
      }

      // Cache the rate
      this.rateCache.set(cacheKey, { rate, timestamp: Date.now() });
      this.logger.log(`Fetched ${currency} rate: ${rate} NGN per unit`);

      return rate;
    } catch (error) {
      this.logger.error(
        `Failed to fetch ${currency} rate from Coingecko: ${error?.message}`,
      );
      // Return fallback rate if API call fails
      return fallbackRate;
    }
  }

  /**
   * Maps currency symbols to Coingecko coin IDs
   */
  private getCoinId(currency: string): string | null {
    const mapping: Record<string, string> = {
      usdc: 'usd-coin',
      usdt: 'tether',
      btc: 'bitcoin',
      eth: 'ethereum',
    };

    return mapping[currency.toLowerCase()] || null;
  }

  /**
   * Clear cache (useful for testing or manual refresh)
   */
  clearCache(): void {
    this.rateCache.clear();
    this.logger.log('Exchange rate cache cleared');
  }
}
