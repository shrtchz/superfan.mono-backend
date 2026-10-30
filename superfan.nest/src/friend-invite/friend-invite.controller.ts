import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiRoutes } from '../common/enums/routes.enum';
import { Public } from '../common/decorators';
import { FriendInviteService } from './friend-invite.service';
import {
  AcceptChallengeInviteDto,
  DeclineChallengeInviteDto,
  PendingInvitesQueryDto,
  SendChallengeInviteDto,
} from './dto/friend-invite.dto';

@Controller(ApiRoutes.FRIEND_INVITE)
export class FriendInviteController {
  constructor(private readonly friendInviteService: FriendInviteService) {}

  @Post('/send')
  send(@Req() req: any, @Body() dto: SendChallengeInviteDto) {
    return this.friendInviteService.send(req.user.id, dto.receiverId);
  }

  @Get('/pending')
  pending(@Req() req: any, @Query() query: PendingInvitesQueryDto) {
    return this.friendInviteService.pending(req.user.id);
  }

  @Get('/sent')
  sent(@Req() req: any) {
    return this.friendInviteService.sent(req.user.id);
  }

  @Get('/friends')
  friends(@Req() req: any, @Query() query: any) {
    return this.friendInviteService.friends(req.user.id);
  }

  @Public()
  @Post('/:inviteId/accept')
  accept(
    @Param('inviteId', ParseIntPipe) inviteId: number,
    @Body() dto: AcceptChallengeInviteDto,
  ) {
    return this.friendInviteService.accept(inviteId);
  }

  @Public()
  @Post('/:inviteId/decline')
  decline(
    @Param('inviteId', ParseIntPipe) inviteId: number,
    @Body() dto: DeclineChallengeInviteDto,
  ) {
    return this.friendInviteService.decline(inviteId);
  }
}