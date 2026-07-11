import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../common/decorators';
import { ApiRoutes } from '../common/enums/routes.enum';
import { Role } from '../common/enums/role.enum';
import { JwtGuard } from '../common/guards';
import { RoleGuard } from '../common/guards/roles.guard';
import {
  PostStreamChatCommentDto,
  ReportStreamChatCommentDto,
  ShareStreamDto,
  StreamChatLockActionDto,
} from './stream-user.dto';
import { StreamGateway } from './stream.gateway';
import { StreamingService } from './stream.service';

@UseGuards(JwtGuard)
@Controller(ApiRoutes.STREAM_USER)
export class StreamUserController {
  constructor(
    private readonly streamingService: StreamingService,
    private readonly streamGateway: StreamGateway,
  ) {}

  @Get('chat')
  async getChatFeed(@Query('streamId', ParseIntPipe) streamId: number) {
    return this.streamingService.getUserChatFeed(streamId);
  }

  @Get('chat/status')
  async getChatStatus(@Query('streamId', ParseIntPipe) streamId: number) {
    return this.streamingService.getStreamChatStatus(streamId);
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin, Role.moderator)
  @Post('chat/lock')
  async lockChat(@Body() dto: StreamChatLockActionDto, @Req() req) {
    const result = await this.streamingService.setStreamChatLock(
      dto.streamId,
      true,
      Number(req.user?.id),
    );
    this.streamGateway.broadcastToStream(dto.streamId, 'chatLockChanged', result);
    return result;
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin, Role.moderator)
  @Post('chat/unlock')
  async unlockChat(@Body() dto: StreamChatLockActionDto, @Req() req) {
    const result = await this.streamingService.setStreamChatLock(
      dto.streamId,
      false,
      Number(req.user?.id),
    );
    this.streamGateway.broadcastToStream(dto.streamId, 'chatLockChanged', result);
    return result;
  }

  @Post('chat/comment')
  async postComment(
    @Body() dto: PostStreamChatCommentDto,
    @Req() req,
  ) {
    const userId = Number(req.user?.id);
    const created = await this.streamingService.commentOnStream(
      dto.streamId,
      dto.comment,
      userId,
    );

    this.streamGateway.broadcastToStream(dto.streamId, 'streamMessage', {
      ...created,
      streamId: dto.streamId,
    });

    return created;
  }

  @Post('chat/comment/:id/like')
  async likeComment(
    @Param('id', ParseIntPipe) commentId: number,
    @Req() req,
  ) {
    const userId = Number(req.user?.id);
    const result = await this.streamingService.likeComment(commentId, userId);
    const streamId =
      result?.data?.streamId ??
      (await this.streamingService.getCommentStreamId(commentId));

    if (streamId) {
      this.streamGateway.broadcastToStream(streamId, 'likeComment', {
        commentId,
        streamId,
        userId,
        likesCount: result?.data?.likesCount,
      });
    }

    return {
      commentId,
      likesCount: result?.data?.likesCount ?? 0,
    };
  }

  @Post('chat/comment/:id/report')
  @HttpCode(HttpStatus.ACCEPTED)
  async reportComment(
    @Param('id', ParseIntPipe) commentId: number,
    @Body() dto: ReportStreamChatCommentDto,
    @Req() req,
  ) {
    const userId = Number(req.user?.id);
    await this.streamingService.reportComment(
      commentId,
      userId,
      userId,
      dto.reason,
    );

    return { received: true };
  }

  @Delete('chat/comment/:id')
  @HttpCode(HttpStatus.OK)
  async deleteOwnComment(
    @Param('id', ParseIntPipe) commentId: number,
    @Req() req,
  ) {
    const userId = Number(req.user?.id);
    const deleted = await this.streamingService.deleteOwnStreamComment(
      commentId,
      userId,
    );

    if (deleted?.streamId) {
      this.streamGateway.broadcastToStream(deleted.streamId, 'deleteComment', {
        commentId,
        streamId: deleted.streamId,
      });
    }

    return { deleted: true, commentId };
  }

  @Post('share')
  async shareStream(@Body() dto: ShareStreamDto) {
    return this.streamingService.buildStreamSharePayload(dto.streamId);
  }
}
