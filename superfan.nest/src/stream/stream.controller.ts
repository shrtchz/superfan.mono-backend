import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { ApiRoutes } from '../common/enums/routes.enum';
import { JwtGuard } from '../common/guards';
import { ElasticsearchService } from '../elasticsearch/elasticsearch.service';
import { EditStreamDto, StartStreamDto } from './stream.dto';
import { StreamingService, StreamSession } from './stream.service';

@UseGuards(JwtGuard)
@Controller(ApiRoutes.STREAMING)
export class StreamingController {
  constructor(private readonly streamingService: StreamingService, private readonly elasticsearchService: ElasticsearchService) {}


  // store youtube access_token
  @Post('save_tokens')
  async saveToken(
    @Body() tokens: {
      access_token?: string;
      refresh_token?: string;
      expiry_date?: number;
      scope?: string;
      token_type?: string;
      service?: string;
    },
    @Req() req,
  ) {
    const userId = req.user?.id;

    // Ensure a service name is present for the DB upsert
    const payload = { ...tokens, service: tokens.service ?? 'youtube' };

    await this.streamingService.persistYoutubeTokens(payload);
    
    // 🔥 CRITICAL: Update the in-memory OAuth client so it doesn't keep using the old tokens!
    this.streamingService.setCredentials({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
    });

    return { message: 'YouTube tokens saved', userId };
  }
  /**
   * Visit this URL in your browser to kick off the OAuth flow.
   * Redirects you to Google's consent screen.
   */
  @Get('auth')
  startAuth() {
    return {
      authUrl: this.streamingService.generateAuthUrl(),
    };
  }

  /**
   * Google redirects here after the user grants permission.
   * YOUTUBE_REDIRECT_URI in your .env must match this exactly:
   * e.g. http://localhost:3000/streaming/oauth2callback
   */
  @Get('oauth2callback')
  async handleCallback(@Query('code') code: string) {
    const tokens = await this.streamingService.handleOAuthCallback(code);

    // In production: save tokens to your DB here
    return tokens;
  }

  @Get('refresh-token')
  async refreshToken(@Query('code') code: string) {
    const tokens = await this.streamingService.refreshAccessToken(code);

    // In production: save tokens to your DB here
    return tokens;
  }

  /** POST /streams/start — create broadcast + stream in one call */
  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  async start(@Body() dto: StartStreamDto, @Req() req): Promise<StreamSession> {
    const userId = req.user?.id;
    return this.streamingService.startStream(
      Number(userId),
      dto.title,
      dto.description,
      dto.network_platform,
      dto.stream_url,
      dto.status,
      dto.scheduledDate,
      dto.category,
      dto.thumbnailUrl,
      dto.liveTiming,
      dto.preRecordedTiming,
      dto.recordedVideoUrl,
      dto.duration,
      {
        privacyStatus: dto.privacyStatus,
      },
    );
  }

  @Patch(':streamId')
async editStream(
  @Param('streamId', ParseIntPipe) streamId: number,
  @Body() editStreamDto: EditStreamDto,
  @Req() req: any,
): Promise<StreamSession> {
  const userId = req.user.id;

  return this.streamingService.editStream(
    userId,
    streamId,
    editStreamDto.title,
    editStreamDto.description,
    editStreamDto.network_platform,
    editStreamDto.stream_url,
    editStreamDto.status,
    editStreamDto.scheduledDate,
    editStreamDto.category,
    editStreamDto.thumbnailUrl,
    editStreamDto.liveTiming,
    editStreamDto.preRecordedTiming,
    editStreamDto.recordedVideoUrl,
    editStreamDto.duration,
    editStreamDto.privacyStatus,
  );
}

  @Get('streams')
  async getStreams() {
    return this.streamingService.getStream();
  }

  /** POST /streams/:broadcastId/live — transition to live after encoder connects */
  @Post(':broadcastId/live')
  @HttpCode(HttpStatus.NO_CONTENT)
  async goLive(@Param('broadcastId') broadcastId: string): Promise<void> {
    return this.streamingService.goLive(broadcastId);
  }

  /** POST /streams/:broadcastId/end — end a live stream */
  @Post(':broadcastId/end')
  @HttpCode(HttpStatus.NO_CONTENT)
  async end(@Param('broadcastId') broadcastId: string): Promise<void> {
    return this.streamingService.endStream(broadcastId);
  }

  @Post(':streamId/comment')
  async comment(
    @Param('streamId') streamId: number,
    @Body('comment') comment: string,
    @Req() req,
  ) {
    const userId = req.user?.id;
    return this.streamingService.commentOnStream(
      streamId,
      comment,
      Number(userId),
    );
  }

    @Post('/lock-comment')
  async lockChat(@Query('streamId') streamId: number, @Query('lock') lock: boolean) {
    return this.streamingService.lockandUnlockChat(streamId, lock);
  }

    @Get('/video-stats')
  async getVideos(@Query('videoId') videoId: string) {
    return this.streamingService.getVideoViews(videoId);
  }

  @Get('/comment')
  async getStreamcomment(@Query('streamId') streamId: number) {
    return this.streamingService.getStreamCommentsandReplies(streamId);
  }

     @Get('search')
    async searchcommentAndReply(
      @Query('streamId') streamId: number,
      @Query('q') query: string,
    ) {
      return this.elasticsearchService.searchCommentAndReply(streamId, query);
    }


  @Post('comment/:commentId/reply')
  async reply(
    @Param('commentId') commentId: number,
    @Body('comment') comment: string,
    @Req() req,
  ) {
    const userId = req.user?.id;
    return this.streamingService.replyToComment(
      commentId,
      comment,
      Number(userId),
    );
  }

    @Post('pin-comment/:commentId')
  async pinComment(
    @Param('commentId') commentId: number,
  ) {
    // const userId = req.user?.id;
    return this.streamingService.pinComment(
      commentId,
    );
  }

      @Post('tag-winner/:commentId')
  async tagWInner(
    @Param('commentId') commentId: number,
    @Body('winAmount') winAmount: number,
  ) {
    // const userId = req.user?.id;
    return this.streamingService.isWinner(
      commentId,
      winAmount
    );
  }

  @Post('comment/:commentId/report')
  async report(
    @Param('commentId') commentId: number,
     @Param('userId') userId: number,
    @Body('reason') reason: string,
    @Req() req,
  ) {
    const creatorId = req.user?.id;
    return this.streamingService.reportComment(
      commentId,
      userId,
      Number(creatorId),
      reason,
    );
  }

  @Post('comment/:commentId/like')
  async likeComment(
    @Param('commentId') commentId: number,
    @Body('reason') reason: string,
    @Req() req,
  ) {
    const userId = req.user?.id;
    return this.streamingService.likeComment(commentId, Number(userId));
  }

  @Post('comment/:commentId/unlike')
  async unlikeComment(@Param('commentId') commentId: number, @Req() req) {
    const userId = req.user?.id;
    let deleteComment = this.streamingService.unlikeComment(
      commentId,
      Number(userId),
    );

    return { message: 'stream successfully deleted', data: deleteComment };
  }



  @Post('comment/:replyId')
  @HttpCode(HttpStatus.OK)
  async deleteReply(@Param('replyId') replyId: number) {
    // const userId = req.user?.id;
    return this.streamingService.deleteReply(replyId);
  }

  @Post('comment/:commentId')
  @HttpCode(HttpStatus.OK)
  async deleteComment(@Param('commentId') commentId: number) {
    // const userId = req.user?.id;
    return this.streamingService.deleteComment(commentId);
  }
}