import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class SendChallengeInviteDto {
  @IsInt()
  @Min(1)
  receiverId!: number;
}

export class AcceptChallengeInviteDto {
  @IsInt()
  @Min(1)
  inviteId!: number;
}

export class DeclineChallengeInviteDto {
  @IsInt()
  @Min(1)
  inviteId!: number;
}

export class PendingInvitesQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  userId?: number;
}

export class FriendListQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  userId?: number;
}