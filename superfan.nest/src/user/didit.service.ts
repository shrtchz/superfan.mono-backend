import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

export interface DiditSessionResponse {
  sessionId: string;
  url: string;
}

export interface DiditDecisionData {
  status: 'Approved' | 'Declined' | 'InReview' | 'Expired' | 'Abandoned';
  rejection_reasons?: string[];
  features?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

@Injectable()
export class DiditService {
  private readonly logger = new Logger(DiditService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  private get apiKey(): string {
    return this.configService.get<string>('DIDIT_API_KEY') || process.env.DIDIT_API_KEY || '';
  }

  private get baseUrl(): string {
    return (
      this.configService.get<string>('DIDIT_BASE_URL') ||
      process.env.DIDIT_BASE_URL ||
      'https://api.didit.me'
    ).replace(/\/+$/, '');
  }

  private get callbackUrl(): string {
    return (
      this.configService.get<string>('DIDIT_CALLBACK_URL') ||
      process.env.DIDIT_CALLBACK_URL ||
      'https://superfan.ng/wallet?kyc_callback=true'
    );
  }

  private get webhookSecret(): string {
    return (
      this.configService.get<string>('DIDIT_WEBHOOK_SECRET') ||
      process.env.DIDIT_WEBHOOK_SECRET ||
      ''
    );
  }

  /**
   * Initializes an identity verification session with Didit (Document + Biometric Liveness check)
   */
  async createSession(userId: number, email?: string): Promise<DiditSessionResponse> {
    if (!this.apiKey) {
      this.logger.warn(
        `[DiditService] DIDIT_API_KEY not configured. Generating mock verification session for user ${userId}`,
      );
      const mockSessionId = `mock_didit_sess_${userId}_${Date.now()}`;
      return {
        sessionId: mockSessionId,
        url: `https://verify.didit.me/session/${mockSessionId}`,
      };
    }

    try {
      const payload = {
        vendor_data: String(userId),
        callback: this.callbackUrl,
        features: 'document_verification,liveness_detection',
        customer_email: email,
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/v1/session/`, payload, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
        }),
      );

      const data = response.data;
      const sessionId = data.session_id || data.sessionId || data.id;
      const url = data.url || data.session_url || data.verification_url;

      if (!sessionId || !url) {
        this.logger.error('[DiditService] Invalid session response from Didit', data);
        throw new InternalServerErrorException('Failed to initialize identity verification session');
      }

      this.logger.log(`[DiditService] Created verification session for user ${userId}: ${sessionId}`);
      return { sessionId, url };
    } catch (error: any) {
      this.logger.error(
        `[DiditService] Failed to create Didit session for user ${userId}: ${error.response?.data?.message || error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        error.response?.data?.message || 'Identity verification service unavailable. Please try again.',
      );
    }
  }

  /**
   * Fetches session details or decision from Didit
   */
  async getSessionDetails(sessionId: string): Promise<any> {
    if (!this.apiKey) {
      return { session_id: sessionId, status: 'Approved' };
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/v1/session/${sessionId}/`, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        }),
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(`[DiditService] Failed to get session details for ${sessionId}`, error.message);
      return null;
    }
  }

  /**
   * Verifies the authenticity of Didit webhook callbacks using HMAC-SHA256
   */
  validateWebhookSignature(rawBody: string, signature: string): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('[DiditService] DIDIT_WEBHOOK_SECRET not set; signature verification bypassed');
      return true;
    }

    if (!signature || !rawBody) {
      return false;
    }

    try {
      const hmac = crypto.createHmac('sha256', this.webhookSecret);
      const computedHash = hmac.update(rawBody).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(computedHash, 'utf8'), Buffer.from(signature, 'utf8'));
    } catch (err: any) {
      this.logger.error('[DiditService] Signature validation error', err.message);
      return false;
    }
  }
}
