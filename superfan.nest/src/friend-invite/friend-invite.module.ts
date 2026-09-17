import { Module } from '@nestjs/common';
import { FriendInviteController } from './friend-invite.controller';
import { FriendInviteService } from './friend-invite.service';

@Module({
  imports: [],
  controllers: [FriendInviteController],
  providers: [FriendInviteService],
  exports: [FriendInviteService],
})
export class FriendInviteModule {}