import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import { ApiRoutes } from '../common/enums/routes.enum';
import { ImageService } from './image.service';


@Controller(ApiRoutes.IMAGE)
export class ImageController {
  constructor(private backblaze: ImageService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('image'))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    const url = await this.backblaze.uploadFile(file);

    return {
      message: 'Image uploaded successfully',
      url,
    };
  }
}