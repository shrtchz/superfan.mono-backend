import {
  Body,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import { ApiRoutes } from '../common/enums/routes.enum';
import { ImageService } from './image.service';

@Controller(ApiRoutes.IMAGE)
export class ImageController {
  constructor(private imageService: ImageService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('image'))
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('folder') bodyFolder?: string,
    @Body('type') bodyType?: string,
    @Body('category') bodyCategory?: string,
    @Query('folder') queryFolder?: string,
    @Query('type') queryType?: string,
    @Query('category') queryCategory?: string,
  ) {
    const target =
      bodyFolder ||
      bodyType ||
      bodyCategory ||
      queryFolder ||
      queryType ||
      queryCategory;

    const url = await this.imageService.uploadFile(file, target);

    return {
      message: 'Image uploaded successfully',
      url,
    };
  }
}