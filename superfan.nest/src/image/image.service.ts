import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import 'multer';

const execFileAsync = promisify(execFile);

export type GenericFileInput =
  | Express.Multer.File
  | string
  | { buffer: Buffer; mimetype?: string; originalname?: string };

interface CloudinaryDirectUploadResponse {
  public_id: string;
  secure_url: string;
  url: string;
  format?: string;
  bytes?: number;
  resource_type?: string;
  error?: {
    message: string;
  };
}

@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);
  private cloudName: string = '';
  private apiKey: string = '';
  private apiSecret: string = '';
  private isConfigured = false;

  constructor(private config: ConfigService) {
    this.initCloudinary();
  }

  private initCloudinary() {
    const rawCloudName =
      this.config.get<string>('CLOUDINARY_CLOUD_NAME') ||
      process.env.CLOUDINARY_CLOUD_NAME ||
      '';
    const rawApiKey =
      this.config.get<string>('CLOUDINARY_API_KEY') ||
      process.env.CLOUDINARY_API_KEY ||
      '';
    const rawApiSecret =
      this.config.get<string>('CLOUDINARY_API_SECRET') ||
      process.env.CLOUDINARY_API_SECRET ||
      '';
    const cloudinaryUrl =
      this.config.get<string>('CLOUDINARY_URL') ||
      process.env.CLOUDINARY_URL ||
      '';

    if (cloudinaryUrl) {
      const match = cloudinaryUrl.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
      if (match) {
        this.apiKey = match[1];
        this.apiSecret = match[2];
        this.cloudName = match[3];
        this.isConfigured = true;
        this.logger.log(`Cloudinary configured via CLOUDINARY_URL for cloud: ${this.cloudName}`);
        return;
      }
    }

    if (rawCloudName && rawApiKey && rawApiSecret) {
      this.cloudName = rawCloudName.trim();
      this.apiKey = rawApiKey.trim();
      this.apiSecret = rawApiSecret.trim();
      this.isConfigured = true;
      this.logger.log(`Cloudinary configured for cloud_name: ${this.cloudName}`);
    } else {
      this.logger.warn(
        'Cloudinary credentials are not fully configured. Uploads will fail until CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET (or CLOUDINARY_URL) are set.',
      );
    }
  }

  /**
   * Resolves the Cloudinary target folder based on upload type/category and MIME type.
   *
   * Hierarchy:
   * site_assets/
   * ├── ads/
   * │   ├── imgs/
   * │   └── videos/
   * ├── live_quizes/
   * │   └── attachments/
   * └── profile/
   *     ├── profile_picture/
   *     └── kyc/
   *         ├── face_image/
   *         └── id_card/
   *             ├── front/
   *             └── back/
   */
  resolveFolder(target?: string, mimetype?: string): string {
    const isVideo = mimetype?.toLowerCase().startsWith('video/');
    const normalized = (target || '').trim().toLowerCase();

    switch (normalized) {
      // Ads
      case 'ads':
      case 'ad':
      case 'advert':
      case 'advertisement':
      case 'advertisements':
        return isVideo ? 'site_assets/ads/videos' : 'site_assets/ads/imgs';
      case 'ads_img':
      case 'ads_imgs':
      case 'ads_image':
      case 'ads_images':
      case 'ad_img':
      case 'ad_image':
        return 'site_assets/ads/imgs';
      case 'ads_video':
      case 'ads_videos':
      case 'ad_video':
        return 'site_assets/ads/videos';

      // Live Quizzes & Attachments
      case 'live_quizes':
      case 'live_quiz':
      case 'live_quizes_attachments':
      case 'live_quiz_attachments':
      case 'live_quiz_attachment':
      case 'live_quizes/attachments':
      case 'quiz_attachment':
      case 'quiz_attachments':
      case 'quiz':
      case 'quizzes':
      case 'attachments':
        return 'site_assets/live_quizes/attachments';

      // Profile avatar
      case 'profile':
      case 'profile_picture':
      case 'profile_pic':
      case 'avatar':
      case 'user_avatar':
        return 'site_assets/profile/profile_picture';

      // KYC Selfie / Face Image
      case 'kyc_face':
      case 'kyc_face_image':
      case 'face_image':
      case 'selfie':
      case 'kyc_selfie':
      case 'verify_photo':
        return 'site_assets/profile/kyc/face_image';

      // KYC ID Card Front
      case 'kyc_id_front':
      case 'id_card_front':
      case 'id_front':
      case 'front_image':
      case 'front':
        return 'site_assets/profile/kyc/id_card/front';

      // KYC ID Card Back
      case 'kyc_id_back':
      case 'id_card_back':
      case 'id_back':
      case 'back_image':
      case 'back':
        return 'site_assets/profile/kyc/id_card/back';

      // General KYC folder
      case 'kyc':
        return 'site_assets/profile/kyc';

      default:
        if (normalized.startsWith('site_assets/')) {
          return target!.trim();
        }
        if (normalized.length > 0) {
          return `site_assets/${target!.trim().replace(/^\/+/, '')}`;
        }
        return isVideo ? 'site_assets/ads/videos' : 'site_assets';
    }
  }

  private generateSignature(params: Record<string, string | number>, apiSecret: string): string {
    const sortedKeys = Object.keys(params).sort();
    const stringToSign =
      sortedKeys.map((key) => `${key}=${params[key]}`).join('&') + apiSecret;
    return crypto.createHash('sha1').update(stringToSign).digest('hex');
  }

  private async getVideoDurationSeconds(file: Express.Multer.File): Promise<number> {
    const tempDir = os.tmpdir();
    const tempPath = path.join(
      tempDir,
      `superfan-video-${Date.now()}-${Math.random().toString(16).slice(2)}.${
        file.originalname?.split('.').pop() || 'mp4'
      }`,
    );
    fs.writeFileSync(tempPath, file.buffer);

    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=nw=1:nk=1',
        tempPath,
      ]);

      const duration = Number.parseFloat(stdout.trim());
      if (!Number.isFinite(duration)) {
        throw new Error('Could not determine video duration');
      }

      return duration;
    } finally {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  }

  /**
   * Uploads an Express.Multer.File to Cloudinary.
   */
  async uploadFile(file: Express.Multer.File, folderOrType?: string): Promise<string> {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided for upload');
    }

    if (!this.isConfigured) {
      this.initCloudinary();
    }

    if (!this.cloudName || !this.apiKey || !this.apiSecret) {
      throw new BadRequestException(
        'Cloudinary credentials are not configured on the server. Please check CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
      );
    }

    if (file.mimetype?.startsWith('video/')) {
      try {
        const durationSeconds = await this.getVideoDurationSeconds(file);
        if (durationSeconds > 180) {
          throw new BadRequestException('video more than 3mins');
        }
      } catch (error) {
        if (error instanceof BadRequestException) {
          throw error;
        }
        this.logger.warn(
          `ffprobe video validation skipped/failed: ${error?.message || error}`,
        );
      }
    }

    const folder = this.resolveFolder(folderOrType, file.mimetype);
    const timestamp = Math.floor(Date.now() / 1000);

    const signParams: Record<string, string | number> = {
      folder,
      timestamp,
    };

    const signature = this.generateSignature(signParams, this.apiSecret);

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(file.buffer)], {
      type: file.mimetype || 'application/octet-stream',
    });

    formData.append('file', blob, file.originalname || 'media_upload');
    formData.append('api_key', this.apiKey);
    formData.append('timestamp', timestamp.toString());
    formData.append('folder', folder);
    formData.append('signature', signature);

    const uploadEndpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(this.cloudName)}/auto/upload`;

    try {
      const response = await axios.post<CloudinaryDirectUploadResponse>(
        uploadEndpoint,
        formData,
        {
          timeout: 90000,
        },
      );

      if (response.data?.error?.message) {
        throw new Error(response.data.error.message);
      }

      const finalUrl = response.data.secure_url || response.data.url;
      if (!finalUrl) {
        throw new Error('Cloudinary response did not contain a secure_url');
      }

      this.logger.log(`File uploaded to Cloudinary: ${finalUrl} (folder: ${folder})`);
      return finalUrl;
    } catch (error: any) {
      const errMsg =
        error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        error?.message ||
        'Failed to upload media to Cloudinary';
      this.logger.error(`Cloudinary upload failed: ${errMsg}`, error?.stack);
      throw new BadRequestException(`Cloudinary upload failed: ${errMsg}`);
    }
  }

  /**
   * Uploads any file input (Multer file, Buffer object, or Base64 / Data URI string) to Cloudinary.
   */
  async uploadFileInput(
    input: GenericFileInput,
    folderOrType?: string,
  ): Promise<string> {
    if (!input) {
      throw new BadRequestException('No file input provided');
    }

    if (!this.isConfigured) {
      this.initCloudinary();
    }

    if (!this.cloudName || !this.apiKey || !this.apiSecret) {
      throw new BadRequestException(
        'Cloudinary credentials are not configured on the server. Please check CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
      );
    }

    // String input: Data URI or raw Base64 string
    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (!trimmed) {
        throw new BadRequestException('Empty file string provided');
      }

      let dataUri = trimmed;
      let mimetype = 'image/jpeg';

      if (trimmed.startsWith('data:')) {
        const match = trimmed.match(/^data:([^;]+);base64,/);
        if (match) {
          mimetype = match[1];
        }
      } else {
        dataUri = `data:image/jpeg;base64,${trimmed}`;
      }

      const folder = this.resolveFolder(folderOrType, mimetype);
      const timestamp = Math.floor(Date.now() / 1000);

      const signParams: Record<string, string | number> = {
        folder,
        timestamp,
      };

      const signature = this.generateSignature(signParams, this.apiSecret);

      const formData = new FormData();
      formData.append('file', dataUri);
      formData.append('api_key', this.apiKey);
      formData.append('timestamp', timestamp.toString());
      formData.append('folder', folder);
      formData.append('signature', signature);

      const uploadEndpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(this.cloudName)}/auto/upload`;

      try {
        const response = await axios.post<CloudinaryDirectUploadResponse>(
          uploadEndpoint,
          formData,
          {
            timeout: 90000,
          },
        );

        if (response.data?.error?.message) {
          throw new Error(response.data.error.message);
        }

        const finalUrl = response.data.secure_url || response.data.url;
        if (!finalUrl) {
          throw new Error('Cloudinary response did not contain a secure_url');
        }

        this.logger.log(`Base64 uploaded to Cloudinary: ${finalUrl} (folder: ${folder})`);
        return finalUrl;
      } catch (error: any) {
        const errMsg =
          error?.response?.data?.error?.message ||
          error?.response?.data?.message ||
          error?.message ||
          'Failed to upload Base64 media to Cloudinary';
        this.logger.error(`Cloudinary upload failed: ${errMsg}`, error?.stack);
        throw new BadRequestException(`Cloudinary upload failed: ${errMsg}`);
      }
    }

    // Multer file or Buffer object
    if (typeof input === 'object' && 'buffer' in input && Buffer.isBuffer(input.buffer)) {
      return this.uploadFile(input as Express.Multer.File, folderOrType);
    }

    throw new BadRequestException('Unsupported file input type');
  }
}