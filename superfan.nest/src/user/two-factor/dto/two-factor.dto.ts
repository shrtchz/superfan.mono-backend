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
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsIn(['text', 'call'])
  channel?: 'text' | 'call';

  @IsOptional()
  @IsIn(['twilio', 'talking_drum', 'africas_talking'])
  provider?: 'twilio' | 'talking_drum' | 'africas_talking';
}

export class VerifyPhoneOtpDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]+$/, { message: 'code must contain only digits' })
  code: string;
}