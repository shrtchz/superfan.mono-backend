import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import 'multer';


@Injectable()
export class ImageService {
  private authToken: string;
  private apiUrl: string;
  private downloadUrl: string;

  constructor(private config: ConfigService) {}

  async authorize() {
  const keyId = this.config.get('B2_KEY_ID');
  const appKey = this.config.get('B2_APPLICATION_KEY');

  const auth = Buffer.from(`${keyId}:${appKey}`).toString('base64');

  const res = await axios.get(
    'https://api005.backblazeb2.com/b2api/v4/b2_authorize_account',
    {
      headers: { Authorization: `Basic ${auth}` },
    },
  );

  const storageApi = res.data.apiInfo.storageApi;

  this.authToken = res.data.authorizationToken;
  this.apiUrl = storageApi.apiUrl;
  this.downloadUrl = 'https://cloudflare-b2.shrtchz.workers.dev';
  // 'https://images.superfan.ng';

  return res.data;
}

  async getUploadUrl() {
    if (!this.authToken) await this.authorize();

    const bucketId = this.config.get('B2_BUCKET_ID');

    const res = await axios.post(
      `${this.apiUrl}/b2api/v4/b2_get_upload_url`,
      { bucketId },
      {
        headers: {
          Authorization: this.authToken,
        },
      },
    );

    return res.data;
  }

  async uploadFile(file: Express.Multer.File) {
    const uploadData = await this.getUploadUrl();

    const sha1 = crypto.createHash('sha1').update(file.buffer).digest('hex');

    await axios.post(uploadData.uploadUrl, file.buffer, {
      headers: {
        Authorization: uploadData.authorizationToken,
        'X-Bz-File-Name': encodeURIComponent(file.originalname),
        'Content-Type': file.mimetype,
        'Content-Length': file.size,
        'X-Bz-Content-Sha1': sha1,
      },
    });

    const bucketName = this.config.get('B2_BUCKET_NAME');

    return `${this.downloadUrl}/${encodeURIComponent(file.originalname)}`;
  }
}