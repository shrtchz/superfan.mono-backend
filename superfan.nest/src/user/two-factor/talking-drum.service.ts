import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface SendOtpInput {
  phone: string;
  code: string;
  channel?: 'text' | 'call';
}

export interface SendOtpResult {
  simulated: boolean;
  provider: string;
  to: string;
}
/**
 * Sends a numeric OTP to the given phone via Africa's Talking messaging API.
 * Falls back to logging the code to the console when the API key is missing
 * or the environment is not production, so development/testing stays fully
 * functional.
 */
@Injectable()
export class TalkingDrumService {
  private readonly logger = new Logger('AfricasTalkingService');

  constructor(private readonly configService: ConfigService) {}

  async sendOtp(input: SendOtpInput): Promise<SendOtpResult> {
    const { phone, code, channel = 'text' } = input;
    const message = `Your Superfan authentication code is ${code}. Do not share this code with anyone.`;

    if (this.isSimulation()) {
      this.logger.warn(
        `\x1b[33m[AFRICA'S TALKING · SIMULATED ${channel.toUpperCase()} OTP]\x1b[0m to ${phone} -> code \x1b[1m${code}\x1b[0m`,
      );
      return { simulated: true, provider: 'africas-talking-simulation', to: phone };
    }

    const apiKey =
      this.configService.get<string>('AFRICAS_TALKING_API_KEY') ||
      this.configService.get<string>('TALKING_DRUM_API_KEY', '');
    const username =
      this.configService.get<string>('AFRICAS_TALKING_USERNAME', 'sandbox');
    const baseUrl = this.configService
      .get<string>('AFRICAS_TALKING_BASE_URL', 'https://api.africastalking.com')
      .replace(/\/+$/, '');
    const smsPath = this.configService.get<string>(
      'AFRICAS_TALKING_SMS_PATH',
      '/version1/messaging/bulk',
    );
    const senderId =
      this.configService.get<string>('AFRICAS_TALKING_SENDER_ID') ||
      this.configService.get<string>('TALKING_DRUM_SENDER_ID');
    const maskedNumber = this.configService.get<string>('AFRICAS_TALKING_MASKED_NUMBER');
    const telco = this.configService.get<string>('AFRICAS_TALKING_TELCO');

    try {
      const payload: Record<string, unknown> = {
        username,
        message,
        phoneNumbers: [phone],
      };

      if (senderId && senderId.trim()) {
        payload.senderId = senderId.trim();
      }
      if (maskedNumber && maskedNumber.trim()) {
        payload.maskedNumber = maskedNumber.trim();
      }
      if (telco && telco.trim()) {
        payload.telco = telco.trim();
      }

      await axios.post(
        `${baseUrl}${smsPath}`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            apiKey,
          },
          timeout: 15000,
        },
      );

      return { simulated: false, provider: 'africas-talking', to: phone };
    } catch (error) {
      this.logger.error(
        `Africa's Talking ${channel} delivery failed for ${phone}`,
        error instanceof Error ? error.message : JSON.stringify(error),
      );
      throw new ServiceUnavailableException(
        'Unable to send your verification code right now. Please try again.',
      );
    }
  }

  private isSimulation(): boolean {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    const apiKey =
      this.configService.get<string>('AFRICAS_TALKING_API_KEY') ||
      this.configService.get<string>('TALKING_DRUM_API_KEY', '');
    return nodeEnv !== 'production' || !apiKey;
  }
}

export { TalkingDrumService as AfricasTalkingService };