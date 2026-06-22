import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class StartStreamDto {
  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsString()
  network_platform?: 'youtube' | 'twitch';

  @IsString()
  @IsOptional()
  stream_url?: string;

  @IsString()
  status?: 'live' | 'pre-recorded';

  @IsString()
   @IsOptional()
  scheduledDate?: Date;

  @IsString()
   @IsOptional()
  category?: string;

  @IsString()
   @IsOptional()
  thumbnailUrl?: string;

  @IsString()
   @IsOptional()
  liveTiming?: 'going_now' | 'schedule_for_later';

  @IsString()
   @IsOptional()
  preRecordedTiming?: 'available_now' | 'schedule_for_later';

  @IsString()
   @IsOptional()
  duration?: string;

  @IsString()
   @IsOptional()
  recordedVideoUrl?: string;

  @IsString()
   @IsOptional()
  privacyStatus?: 'public' | 'unlisted' | 'private';
}

export class StreamOptionsDto {
  @IsOptional()
  @IsEnum(['public', 'private', 'unlisted'])
  privacyStatus?: 'public' | 'private' | 'unlisted';
}

export class EditStreamDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  network_platform?: string;

  @IsOptional()
  @IsString()
  stream_url?: string;

  @IsOptional()
  @IsEnum(['live', 'pre-recorded'])
  status?: 'live' | 'pre-recorded';

  @IsOptional()
  @IsDateString()
  scheduledDate?: Date;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsEnum(['going_now', 'schedule_for_later'])
  liveTiming?: 'going_now' | 'schedule_for_later';

  @IsOptional()
  @IsEnum(['available_now', 'schedule_for_later'])
  preRecordedTiming?: 'available_now' | 'schedule_for_later';

  @IsOptional()
  @IsString()
  recordedVideoUrl?: string;

  @IsOptional()
  @IsString()
  duration?: string;

  @IsOptional()
  @IsEnum(['public', 'private', 'unlisted'])
  privacyStatus?: 'public' | 'private' | 'unlisted';
}


