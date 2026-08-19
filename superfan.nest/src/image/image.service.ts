import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import 'multer';

const execFileAsync = promisify(execFile);

export type GenericFileInput =
  | Express.Multer.File
  | string
  | { buffer: Buffer; mimetype?: string; originalname?: string };

@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);
  private isConfigured = false;

  constructor(private config: ConfigService) {
    this.initCloudinary();
  }

  private initCloudinary() {
    const cloudName =
      this.config.get<string>('CLOUDINARY_CLOUD_NAME') ||
      process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey =
      this.config.get<string>('CLOUDINARY_API_KEY') ||
      process.env.CLOUDINARY_API_KEY;
    const apiSecret =
      this.config.get<string>('CLOUDINARY_API_SECRET') ||
      process.env.CLOUDINARY_API_SECRET;
    const cloudinaryUrl =
      this.config.get<string>('CLOUDINARY_URL') || process.env.CLOUDINARY_URL;

    if (cloudinaryUrl) {
      cloudinary.config({
        cloudinary_url: cloudinaryUrl,
        secure: true,
      });
      this.isConfigured = true;
      this.logger.log('Cloudinary configured via CLOUDINARY_URL');
    } else if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
      this.isConfigured = true;
      this.logger.log(`Cloudinary configured for cloud_name: ${cloudName}`);
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

  async uploadFile(file: Express.Multer.File, folderOrType?: string) {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided for upload');
    }

    if (!this.isConfigured) {
      this.initCloudinary();
    }

    if (file.mimetype?.startsWith('video/')) {
      try {
        const durationSeconds = await this.getVideoDurationSeconds(file);
        if (durationSeconds > 120) {
          throw new BadRequestException(
            `Video is ${Math.round(durationSeconds)}s long. Videos must be 120 seconds or less.`,
          );
        }
      } catch (error) {
        if (error instanceof BadRequestException) {
          throw error;
        }
        // If ffprobe is not installed on the system, log a warning but proceed
        this.logger.warn(
          `ffprobe video validation skipped/failed: ${error?.message || error}`,
        );
      }
    }

    const folder = this.resolveFolder(folderOrType, file.mimetype);

    const uploadResult = await new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'auto',
          use_filename: true,
          unique_filename: true,
          overwrite: false,
        },
        (error, result) => {
          if (error || !result) {
            this.logger.error('Cloudinary upload error:', error);
            return reject(
              new BadRequestException(
                error?.message || 'Failed to upload media to Cloudinary',
              ),
            );
          }
          resolve(result);
        },
      );

      Readable.from(file.buffer).pipe(uploadStream);
    });

    this.logger.log(
      `File uploaded to Cloudinary: ${uploadResult.secure_url} (folder: ${folder})`,
    );

    return uploadResult.secure_url;
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
        // Raw Base64: prepend data URI scheme
        dataUri = `data:image/jpeg;base64,${trimmed}`;
      }

      const folder = this.resolveFolder(folderOrType, mimetype);

      const result = await cloudinary.uploader.upload(dataUri, {
        folder,
        resource_type: 'auto',
      });

      this.logger.log(
        `Base64 file uploaded to Cloudinary: ${result.secure_url} (folder: ${folder})`,
      );
      return result.secure_url;
    }

    // Multer file or Buffer object
    if (typeof input === 'object' && 'buffer' in input && Buffer.isBuffer(input.buffer)) {
      const folder = this.resolveFolder(folderOrType, input.mimetype);

      const uploadResult = await new Promise<UploadApiResponse>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder,
            resource_type: 'auto',
            use_filename: true,
            unique_filename: true,
            overwrite: false,
          },
          (error, result) => {
            if (error || !result) {
              this.logger.error('Cloudinary upload error:', error);
              return reject(
                new BadRequestException(
                  error?.message || 'Failed to upload media to Cloudinary',
                ),
              );
            }
            resolve(result);
          },
        );

        Readable.from(input.buffer).pipe(uploadStream);
      });

      this.logger.log(
        `Buffer file uploaded to Cloudinary: ${uploadResult.secure_url} (folder: ${folder})`,
      );
      return uploadResult.secure_url;
    }

    throw new BadRequestException('Unsupported file input type');
  }
}