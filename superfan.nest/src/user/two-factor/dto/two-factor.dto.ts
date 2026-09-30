import { IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

const PHONE_REGEX = /^\+?[0-9]{6,15}$/;

export class SetupTotpDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  account?: string;
}

export class VerifyTotpDto {
  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]+$/, { message: 'code must contain only digits' })
  code: string;

  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(255)
  secret?: string;
}

export class SendPhoneOtpDto {
  @IsString()
  @Matches(PHONE_REGEX, { message: 'phone must be a valid phone number' })
  phone: string;

  @IsOptional()
  @IsIn(['text', 'call'])
  channel?: 'text' | 'call';
}

export class VerifyPhoneOtpDto {
  @IsString()
  @Matches(PHONE_REGEX, { message: 'phone must be a valid phone number' })
  phone: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]+$/, { message: 'code must contain only digits' })
  code: string;
}