import { Injectable, Logger, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';

export interface DiditIdVerificationResponse {
  request_id: string;
  id_verification: {
    status: 'Approved' | 'Declined' | 'In Review' | 'InReview' | string;
    document_type?: string;
    document_subtype?: string;
    issuing_state?: string;
    issuing_state_name?: string;
    first_name?: string;
    last_name?: string;
    full_name?: string;
    date_of_birth?: string;
    date_of_issue?: string;
    expiration_date?: string;
    document_number?: string;
    personal_number?: string | null;
    gender?: string;
    nationality?: string;
    address?: string | null;
    place_of_birth?: string | null;
    warnings?: any[];
  };
  vendor_data: string;
  metadata?: any;
  created_at: string;
}

export interface DiditDatabaseValidationResponse {
  request_id: string;
  status: 'Approved' | 'Declined' | 'In Review' | 'InReview' | string;
  issuing_state: string;
  match_type: 'full_match' | 'partial_match' | 'no_match' | string;
  validations: Array<{
    outcome_code: 'MATCH' | 'PARTIAL_MATCH' | 'NO_MATCH' | string;
    service_id: string;
    service_name: string;
    source_data?: Record<string, any>;
  }>;
}

export interface DiditCreateSessionResponse {
  session_id: string;
  url: string;
  session_token?: string;
  status?: string;
  workflow_id?: string;
  vendor_data?: string;
  callback?: string;
}

export interface DiditSessionDecisionResponse {
  session_id: string;
  status: 'Approved' | 'Declined' | 'In Review' | 'InReview' | 'Pending' | string;
  decision?: {
    status?: 'Approved' | 'Declined' | 'In Review' | 'InReview' | 'Pending' | string;
    rejection_reasons?: string[];
    verification_id?: string;
    id_verification?: any;
    database_validation?: any;
    [key: string]: any;
  };
  vendor_data?: string;
  workflow_id?: string;
  created_at?: string;
  [key: string]: any;
}

export type FileUploadInput =
  | Express.Multer.File
  | { buffer: Buffer; originalname?: string; mimetype?: string }
  | string; // base64 data URL or raw base64 string

@Injectable()
export class DiditService {
  private readonly logger = new Logger(DiditService.name);

  constructor(private readonly configService: ConfigService) {}

  private get apiKey(): string {
    return (
      this.configService.get<string>('DIDIT_API_KEY') ||
      process.env.DIDIT_API_KEY ||
      '2FF3GcIvUJtgoMMBYlMXk1mRKs7sb7-tyEY1dBjDYHQ'
    );
  }

  private get baseUrl(): string {
    return (
      this.configService.get<string>('DIDIT_BASE_URL') ||
      process.env.DIDIT_BASE_URL ||
      'https://verification.didit.me/v3'
    ).replace(/\/+$/, '');
  }

  private get webhookSecret(): string {
    return (
      this.configService.get<string>('DIDIT_WEBHOOK_SECRET') ||
      process.env.DIDIT_WEBHOOK_SECRET ||
      ''
    );
  }

  private get workflowId(): string {
    return (
      this.configService.get<string>('DIDIT_WORKFLOW_ID') ||
      process.env.DIDIT_WORKFLOW_ID ||
      'a885a4bb-7c24-45db-a5db-a1ef8eb9e820'
    );
  }

  private get callbackUrl(): string {
    return (
      this.configService.get<string>('DIDIT_CALLBACK_URL') ||
      process.env.DIDIT_CALLBACK_URL ||
      'https://superfan.ng/profile'
    );
  }

  /**
   * Converts various file inputs (Multer file, Buffer, Base64 data URL) into a Blob for FormData
   */
  private parseFileToBlob(
    input: FileUploadInput,
    defaultName = 'document.jpg',
    defaultMime = 'image/jpeg',
  ): { blob: Blob; filename: string } {
    if (typeof input === 'string') {
      // Check if base64 data URI
      if (input.startsWith('data:')) {
        const matches = input.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const mimeType = matches[1];
          const buffer = Buffer.from(matches[2], 'base64');
          return {
            blob: new Blob([new Uint8Array(buffer)], { type: mimeType }),
            filename: defaultName,
          };
        }
      }
      // Raw base64 string
      const buffer = Buffer.from(input, 'base64');
      return {
        blob: new Blob([new Uint8Array(buffer)], { type: defaultMime }),
        filename: defaultName,
      };
    }

    if (input && typeof input === 'object' && 'buffer' in input && Buffer.isBuffer(input.buffer)) {
      const mime = input.mimetype || defaultMime;
      const name = input.originalname || defaultName;
      return {
        blob: new Blob([new Uint8Array(input.buffer)], { type: mime }),
        filename: name,
      };
    }

    throw new BadRequestException('Invalid file input provided for verification');
  }

  /**
   * Standalone v3 ID Document Verification
   * POST https://verification.didit.me/v3/id-verification/
   */
  async verifyIdDocument(
    userId: number,
    frontImage: FileUploadInput,
    backImage?: FileUploadInput,
    options?: {
      performDocumentLiveness?: boolean;
      saveApiRequest?: boolean;
    },
  ): Promise<DiditIdVerificationResponse> {
    if (!frontImage) {
      throw new BadRequestException('front_image is required for ID verification');
    }

    const formData = new FormData();

    const { blob: frontBlob, filename: frontFilename } = this.parseFileToBlob(
      frontImage,
      `front_user_${userId}.jpg`,
    );
    formData.append('front_image', frontBlob, frontFilename);

    if (backImage) {
      const { blob: backBlob, filename: backFilename } = this.parseFileToBlob(
        backImage,
        `back_user_${userId}.jpg`,
      );
      formData.append('back_image', backBlob, backFilename);
    }

    formData.append(
      'perform_document_liveness',
      options?.performDocumentLiveness !== false ? 'true' : 'false',
    );
    formData.append(
      'save_api_request',
      options?.saveApiRequest !== false ? 'true' : 'false',
    );
    formData.append('vendor_data', `user-${userId}`);

    try {
      this.logger.log(`[DiditService] Sending standalone ID verification for user ${userId}`);
      const response = await axios.post<DiditIdVerificationResponse>(
        `${this.baseUrl}/id-verification/`,
        formData,
        {
          headers: {
            'x-api-key': this.apiKey,
          },
        },
      );

      this.logger.log(
        `[DiditService] ID verification response for user ${userId}: status=${response.data?.id_verification?.status}`,
      );
      return response.data;
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.message ||
        error.response?.data?.detail ||
        error.response?.data?.error ||
        error.message;
      this.logger.error(
        `[DiditService] Failed ID verification for user ${userId}: ${JSON.stringify(error.response?.data || error.message)}`,
      );
      throw new BadRequestException(errorMsg || 'Failed to verify ID document with Didit');
    }
  }

  /**
   * Standalone v3 Database Validation: BVN (Nigeria Bank Verification Number)
   * POST https://verification.didit.me/v3/database-validation/
   */
  async validateBvn(
    userId: number,
    firstName: string,
    lastName: string,
    bvn: string,
  ): Promise<DiditDatabaseValidationResponse> {
    if (!bvn) {
      throw new BadRequestException('bvn is required');
    }

    const formData = new FormData();
    formData.append('issuing_state', 'NGA');
    formData.append('services', 'nga_bank_verification_number');
    formData.append('vendor_data', `user-${userId}`);
    formData.append('first_name', firstName || '');
    formData.append('last_name', lastName || '');
    formData.append('bvn', bvn.trim());

    try {
      this.logger.log(
        `[DiditService] Validating BVN for user ${userId} (${firstName} ${lastName})`,
      );
      const response = await axios.post<DiditDatabaseValidationResponse>(
        `${this.baseUrl}/database-validation/`,
        formData,
        {
          headers: {
            'x-api-key': this.apiKey,
          },
        },
      );

      this.logger.log(
        `[DiditService] BVN validation response for user ${userId}: status=${response.data?.status}, match=${response.data?.match_type}`,
      );
      return response.data;
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.message ||
        error.response?.data?.detail ||
        error.response?.data?.error ||
        error.message;
      this.logger.error(
        `[DiditService] BVN validation failed for user ${userId}: ${JSON.stringify(error.response?.data || error.message)}`,
      );
      throw new BadRequestException(errorMsg || 'Failed to validate BVN with Didit');
    }
  }

  /**
   * Standalone v3 Database Validation: NIN (Nigeria National ID - NIMC)
   * POST https://verification.didit.me/v3/database-validation/
   */
  async validateNin(
    userId: number,
    firstName: string,
    lastName: string,
    nationalId: string,
  ): Promise<DiditDatabaseValidationResponse> {
    if (!nationalId) {
      throw new BadRequestException('national_id (NIN) is required');
    }

    const formData = new FormData();
    formData.append('issuing_state', 'NGA');
    formData.append('services', 'nga_national_id');
    formData.append('vendor_data', `user-${userId}`);
    formData.append('first_name', firstName || '');
    formData.append('last_name', lastName || '');
    formData.append('national_id', nationalId.trim());

    try {
      this.logger.log(
        `[DiditService] Validating NIN for user ${userId} (${firstName} ${lastName})`,
      );
      const response = await axios.post<DiditDatabaseValidationResponse>(
        `${this.baseUrl}/database-validation/`,
        formData,
        {
          headers: {
            'x-api-key': this.apiKey,
          },
        },
      );

      this.logger.log(
        `[DiditService] NIN validation response for user ${userId}: status=${response.data?.status}, match=${response.data?.match_type}`,
      );
      return response.data;
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.message ||
        error.response?.data?.detail ||
        error.response?.data?.error ||
        error.message;
      this.logger.error(
        `[DiditService] NIN validation failed for user ${userId}: ${JSON.stringify(error.response?.data || error.message)}`,
      );
      throw new BadRequestException(errorMsg || 'Failed to validate NIN with Didit');
    }
  }

  /**
   * Creates a hosted verification session via Didit v3 Session API
   * POST https://verification.didit.me/v3/session/
   */
  async createSession(params: {
    userId: number;
    workflowId?: string;
    vendorData?: string;
    callbackUrl?: string;
  }): Promise<DiditCreateSessionResponse> {
    const workflowId = params.workflowId || this.workflowId;
    const vendorData = params.vendorData || `user-${params.userId}`;
    const callback = params.callbackUrl || this.callbackUrl;

    const payload: Record<string, any> = {
      vendor_data: vendorData,
      callback: callback,
    };

    if (workflowId) {
      payload.workflow_id = workflowId;
    }

    try {
      this.logger.log(
        `[DiditService] Creating hosted session for user ${params.userId}, callback=${callback}, workflow=${workflowId || 'default'}`,
      );

      const response = await axios.post<DiditCreateSessionResponse>(
        `${this.baseUrl}/session/`,
        payload,
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(
        `[DiditService] Hosted session created for user ${params.userId}: sessionId=${response.data?.session_id}, url=${response.data?.url}`,
      );

      return response.data;
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.message ||
        error.response?.data?.detail ||
        error.response?.data?.error ||
        error.message;
      this.logger.error(
        `[DiditService] Failed to create hosted session for user ${params.userId}: ${JSON.stringify(error.response?.data || error.message)}`,
      );
      throw new BadRequestException(errorMsg || 'Failed to create Didit verification session');
    }
  }

  /**
   * Retrieves the full decision payload for a verification session
   * GET https://verification.didit.me/v3/session/{session_id}/decision/
   */
  async getSessionDecision(sessionId: string): Promise<DiditSessionDecisionResponse> {
    if (!sessionId) {
      throw new BadRequestException('sessionId is required to retrieve decision');
    }

    try {
      this.logger.log(`[DiditService] Retrieving session decision for sessionId=${sessionId}`);

      const response = await axios.get<DiditSessionDecisionResponse>(
        `${this.baseUrl}/session/${sessionId}/decision/`,
        {
          headers: {
            'x-api-key': this.apiKey,
          },
        },
      );

      this.logger.log(
        `[DiditService] Retrieved decision for session ${sessionId}: status=${response.data?.status || response.data?.decision?.status}`,
      );

      return response.data;
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.message ||
        error.response?.data?.detail ||
        error.response?.data?.error ||
        error.message;
      this.logger.error(
        `[DiditService] Failed to retrieve decision for session ${sessionId}: ${JSON.stringify(error.response?.data || error.message)}`,
      );
      throw new BadRequestException(errorMsg || 'Failed to retrieve Didit session decision');
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
