import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiRoutes } from '../common/enums/routes.enum';
import { Roles } from '../common/decorators';
import { Role } from '../common/enums/role.enum';
import { JwtGuard } from '../common/guards';
import { RoleGuard } from '../common/guards/roles.guard';
import { EditStreamDto, StartStreamDto } from './stream.dto';
import { StreamingService, StreamSession } from './stream.service';
import { StreamGateway } from './stream.gateway';

@UseGuards(JwtGuard)
@Controller(ApiRoutes.STREAMING)
export class StreamingController {
  constructor(
    private readonly streamingService: StreamingService,
    private readonly streamGateway: StreamGateway,
  ) {}

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
  ) {
    return this.streamingService.persistYoutubeTokens({
      ...tokens,
      service: tokens.service || 'youtube',
    });
  }

  @Get('streams')
  async getStreams() {
    return this.streamingService.getStream();
  }

  @Post('start')
  async start(@Body() dto: StartStreamDto, @Req() req): Promise<StreamSession> {
    return this.streamingService.startStream(
      Number(req.user?.id),
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
      { privacyStatus: dto.privacyStatus },
    );
  }

  @Patch(':id')
  async editStream(
    @Param('id', ParseIntPipe) id: number,
    @Body() editStreamDto: EditStreamDto,
    @Req() req,
  ) {
    return this.streamingService.editStream(
      Number(req.user?.id),
      id,
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

  @Post(':broadcastId/live')
  async goLive(@Param('broadcastId') broadcastId: string): Promise<void> {
    return this.streamingService.goLive(broadcastId);
  }

  @Post(':broadcastId/end')
  async end(@Param('broadcastId') broadcastId: string): Promise<void> {
    return this.streamingService.endStream(broadcastId);
  }

  @Post(':streamId/comment')
  async comment(
    @Param('streamId', ParseIntPipe) streamId: number,
    @Body('comment') comment: string,
    @Req() req,
  ) {
    const userId = req.user?.id;
    const created = await this.streamingService.commentOnStream(
      streamId,
      comment,
      Number(userId),
    );
    this.streamGateway.broadcastChat('streamMessage', {
      ...created,
      streamId,
    });
    return created;
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin, Role.moderator)
  @Post('/lock-comment')
  async lockChat(
    @Query('streamId') streamId: number,
    @Query('lock') lock: boolean,
    @Req() req,
  ) {
    const result = await this.streamingService.setStreamChatLock(
      Number(streamId),
      Boolean(lock),
      Number(req.user?.id),
    );
    this.streamGateway.broadcastChat('chatLockChanged', result);
    return {
      lock_chat: result.locked,
      ...result,
    };
  }

  @Get('/video-stats')
  async getVideos(@Query('videoId') videoId: string) {
    return this.streamingService.getVideoViews(videoId);
  }

  @Get('/comment')
  async getStreamcomment(@Query('streamId') streamId: number) {
    return this.streamingService.getStreamCommentsandReplies(streamId);
  }

  @Get(':id/chat/search')
  async searchStreamChat(
    @Param('id', ParseIntPipe) streamId: number,
    @Query('q') query: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.streamingService.searchStreamChatComments(
      streamId,
      query,
      Number.parseInt(page || '1', 10),
      Number.parseInt(limit || '20', 10),
    );
  }

  @Get('search')
  async searchcommentAndReply(
    @Query('streamId') streamId: number,
    @Query('q') query: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.streamingService.searchStreamChatComments(
      Number(streamId),
      query,
      Number.parseInt(page || '1', 10),
      Number.parseInt(limit || '20', 10),
    );
  }

  @Post('comment/:commentId/reply')
  async reply(
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body('comment') comment: string,
    @Req() req,
  ) {
    const userId = req.user?.id;
    const created = await this.streamingService.replyToComment(
      commentId,
      comment,
      Number(userId),
    );
    if (created?.streamId) {
      this.streamGateway.broadcastChat('replyMessage', created);
    }
    return created;
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin, Role.moderator)
  @Post('pin-comment/:commentId')
  async pinComment(@Param('commentId', ParseIntPipe) commentId: number) {
    const pinned = await this.streamingService.pinComment(commentId);
    if (pinned?.streamId) {
      this.streamGateway.broadcastChat('pinComment', {
        commentId,
        streamId: pinned.streamId,
      });
    }
    return pinned;
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin, Role.moderator)
  @Delete('pin-comment/:commentId')
  async unpinComment(@Param('commentId', ParseIntPipe) commentId: number) {
    return this.streamingService.unpinComment(commentId);
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin, Role.moderator)
  @Post('tag-winner/:commentId')
  async tagWInner(
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body('winAmount') winAmount: number,
  ) {
    return this.streamingService.isWinner(commentId, winAmount);
  }

  @Post('comment/:commentId/report')
  async report(
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body('reason') reason: string,
    @Req() req,
  ) {
    const creatorId = req.user?.id;
    const userId = req.user?.id;
    const result = await this.streamingService.reportComment(
      commentId,
      Number(creatorId),
      Number(userId),
      reason,
    );
    const streamId = await this.streamingService.getCommentStreamId(commentId);
    if (streamId) {
      this.streamGateway.broadcastChat('reportComment', {
        commentId,
        streamId,
        userId,
        reportsCount: result?.reportsCount,
      });
    }
    return result;
  }

  @Post('comment/:commentId/like')
  async likeComment(
    @Param('commentId', ParseIntPipe) commentId: number,
    @Req() req,
  ) {
    const userId = req.user?.id;
    const result = await this.streamingService.likeComment(commentId, Number(userId));
    const streamId = result?.data?.streamId ?? (await this.streamingService.getCommentStreamId(commentId));
    this.streamGateway.broadcastChat('likeComment', {
      commentId,
      streamId,
      userId,
      likesCount: result?.data?.likesCount,
      data: result?.data,
    });
    return result;
  }

  @Post('comment/:commentId/unlike')
  async unlikeComment(
    @Param('commentId', ParseIntPipe) commentId: number,
    @Req() req,
  ) {
    const userId = req.user?.id;
    const result = await this.streamingService.unlikeComment(
      commentId,
      Number(userId),
    );
    const streamId = result?.data?.streamId ?? (await this.streamingService.getCommentStreamId(commentId));
    this.streamGateway.broadcastChat('unlikeComment', {
      commentId,
      streamId,
      userId,
      likesCount: result?.data?.likesCount,
      data: result?.data,
    });
    return { message: 'stream successfully deleted', data: result };
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin, Role.moderator)
  @Post('comment/:replyId')
  @HttpCode(HttpStatus.OK)
  async deleteReply(@Param('replyId', ParseIntPipe) replyId: number) {
    return this.streamingService.deleteReply(replyId);
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin, Role.moderator)
  @Delete('comment/:replyId/reply')
  @HttpCode(HttpStatus.OK)
  async deleteReplyByDelete(@Param('replyId', ParseIntPipe) replyId: number) {
    return this.streamingService.deleteReply(replyId);
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin, Role.moderator)
  @Post('comment/:commentId')
  @HttpCode(HttpStatus.OK)
  async deleteComment(@Param('commentId', ParseIntPipe) commentId: number) {
    const deleted = await this.streamingService.deleteComment(commentId);
    if (deleted?.streamId) {
      this.streamGateway.broadcastChat('deleteComment', {
        commentId,
        streamId: deleted.streamId,
      });
    }
    return deleted;
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin, Role.moderator)
  @Delete('comment/:commentId')
  @HttpCode(HttpStatus.OK)
  async deleteCommentByDelete(@Param('commentId', ParseIntPipe) commentId: number) {
    const deleted = await this.streamingService.deleteComment(commentId);
    if (deleted?.streamId) {
      this.streamGateway.broadcastChat('deleteComment', {
        commentId,
        streamId: deleted.streamId,
      });
    }
    return deleted;
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin, Role.moderator)
  @Post(':streamId/user/:userId/ban')
  async banUserFromStream(
    @Param('streamId', ParseIntPipe) streamId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: { banReason?: string },
    @Req() req,
  ) {
    const bannedBy = Number(req.user?.id);
    const result = await this.streamingService.banUserFromStream(
      streamId,
      userId,
      bannedBy,
      body?.banReason,
    );
    this.streamGateway.broadcastChat('userBanToggled', result);
    return result;
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin, Role.moderator)
  @Post(':streamId/user/:userId/unban')
  async unbanUserFromStream(
    @Param('streamId', ParseIntPipe) streamId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    const result = await this.streamingService.unbanUserFromStream(
      streamId,
      userId,
    );
    this.streamGateway.broadcastChat('userBanToggled', result);
    return result;
  }
}
