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

@Injectable()
export class TalkingDrumService {
  private readonly logger = new Logger(TalkingDrumService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Sends a numeric OTP to the given phone via Talking Drum (OpSMS-style API).
   * Falls back to logging the code to the console when the API key is missing
   * or the environment is not production, so development/testing stays fully
   * functional.
   */
  async sendOtp(input: SendOtpInput): Promise<SendOtpResult> {
    const { phone, code, channel = 'text' } = input;
    const message = `Your Superfan authentication code is ${code}. Do not share this code with anyone.`;

    if (this.isSimulation()) {
      this.logger.warn(
        `\x1b[33m[TALKING DRUM · SIMULATED ${channel.toUpperCase()} OTP]\x1b[0m to ${phone} -> code \x1b[1m${code}\x1b[0m`,
      );
      return { simulated: true, provider: 'talking-drum-simulation', to: phone };
    }

    const apiKey = this.configService.get<string>('TALKING_DRUM_API_KEY', '');
    const baseUrl = this.configService
      .get<string>('TALKING_DRUM_BASE_URL', 'https://api.talkingdrum.africa')
      .replace(/\/+$/, '');
    const smsPath = this.configService.get<string>(
      'TALKING_DRUM_SMS_PATH',
      '/api/http/sms/send',
    );
    const senderId = this.configService.get<string>(
      'TALKING_DRUM_SENDER_ID',
      'Superfan',
    );

    try {
      await axios.post(
        `${baseUrl}${smsPath}`,
        {
          api_token: apiKey,
          recipient: phone,
          sender_id: senderId,
          type: channel === 'call' ? 'voice' : 'otp',
          message,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 15000,
        },
      );

      return { simulated: false, provider: 'talking-drum', to: phone };
    } catch (error) {
      this.logger.error(
        `Talking Drum ${channel} delivery failed for ${phone}`,
        error instanceof Error ? error.message : JSON.stringify(error),
      );
      throw new ServiceUnavailableException(
        'Unable to send your verification code right now. Please try again.',
      );
    }
  }

  private isSimulation(): boolean {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    const apiKey = this.configService.get<string>('TALKING_DRUM_API_KEY', '');
    return nodeEnv !== 'production' || !apiKey;
  }
}