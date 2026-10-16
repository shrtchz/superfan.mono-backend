import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreatePodcastDto {
  @IsString() title: string;
  @IsOptional() @IsString() description?: string;
  @IsInt() @Min(1) episode: number;
  @IsString() host: string;
  @IsOptional() @IsString() guest?: string;
  @IsString() youtubeVideoId: string;
  @IsString() youtubeUrl: string;
  @IsOptional() @IsString() thumbnailUrl?: string;
  @IsOptional() @IsString() duration?: string;
  @IsOptional() @IsIn(['public', 'private', 'unlisted']) privacyStatus?: string;
  @IsOptional() @IsIn(['PROCESSING', 'READY', 'FAILED']) uploadStatus?: string;
}

export class UpdatePodcastDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(1) episode?: number;
  @IsOptional() @IsString() host?: string;
  @IsOptional() @IsString() guest?: string;
  @IsOptional() @IsString() thumbnailUrl?: string;
  @IsOptional() @IsString() duration?: string;
  @IsOptional() @IsIn(['public', 'private', 'unlisted']) privacyStatus?: string;
  @IsOptional() @IsIn(['PROCESSING', 'READY', 'FAILED']) uploadStatus?: string;
}
