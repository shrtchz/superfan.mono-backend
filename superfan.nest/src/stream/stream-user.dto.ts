import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class PostStreamChatCommentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  streamId: number;

  @IsString()
  @IsNotEmpty()
  comment: string;
}

export class ReportStreamChatCommentDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class ShareStreamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  streamId: number;
}

export class StreamChatLockActionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  streamId: number;
}
