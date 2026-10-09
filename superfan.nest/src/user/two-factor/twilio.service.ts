import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface SendTwilioOtpInput {
  phone: string;
  code: string;
  channel?: 'text' | 'call';
}

export interface SendTwilioOtpResult {
  simulated: boolean;
  provider: string;
  to: string;
}

/**
 * Sends a numeric OTP to the given phone via Twilio REST API (SMS or Voice Call).
 * Falls back to logging the code to console when credentials are not configured
 * or environment is non-production, ensuring development/testing stays fully functional.
 */
@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendOtp(input: SendTwilioOtpInput): Promise<SendTwilioOtpResult> {
    const { phone, code, channel = 'text' } = input;
    const message = `Your Superfan authentication code is ${code}. Do not share this code with anyone.`;

    if (this.isSimulation()) {
      this.logger.warn(
        `\x1b[35m[TWILIO · SIMULATED ${channel.toUpperCase()} OTP]\x1b[0m to ${phone} -> code \x1b[1m${code}\x1b[0m`,
      );
      return { simulated: true, provider: 'twilio-simulation', to: phone };
    }

    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID') || '';
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN') || '';
    const fromNumber =
      this.configService.get<string>('TWILIO_PHONE_NUMBER') ||
      this.configService.get<string>('TWILIO_FROM_NUMBER') ||
      '';
    const messagingServiceSid = this.configService.get<string>(
      'TWILIO_MESSAGING_SERVICE_SID',
    );

    const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;

    try {
      if (channel === 'call') {
        // Twilio Voice Call with TwiML
        const spacedCode = code.split('').join(' ');
        const twiml = `<Response><Pause length="1"/><Say voice="alice">Your Superfan verification code is ${spacedCode}. Again, your code is ${spacedCode}. Goodbye.</Say></Response>`;

        const params = new URLSearchParams();
        params.append('To', phone);
        if (fromNumber) params.append('From', fromNumber);
        params.append('Twiml', twiml);

        await axios.post(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
          params.toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: authHeader,
            },
            timeout: 15000,
          },
        );
      } else {
        // Twilio SMS
        const params = new URLSearchParams();
        params.append('To', phone);
        if (messagingServiceSid) {
          params.append('MessagingServiceSid', messagingServiceSid);
        } else if (fromNumber) {
          params.append('From', fromNumber);
        }
        params.append('Body', message);

        await axios.post(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          params.toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: authHeader,
            },
            timeout: 15000,
          },
        );
      }

      return { simulated: false, provider: 'twilio', to: phone };
    } catch (error) {
      this.logger.error(
        `Twilio ${channel} delivery failed for ${phone}`,
        error instanceof Error ? error.message : JSON.stringify(error),
      );
      throw new ServiceUnavailableException(
        'Unable to send your verification code via Twilio right now. Please try again.',
      );
    }
  }

  private isSimulation(): boolean {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    return nodeEnv !== 'production' || !accountSid || !authToken;
  }
}
