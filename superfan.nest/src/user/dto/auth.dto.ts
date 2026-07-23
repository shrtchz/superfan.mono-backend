import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';
import { SubscriptionPlan, TestLevel } from '@prisma/client'
// import {
//   Language,
//   Subject,
//   SubscriptionPlan,
//   TestLevel,
// } from '../../generated/prisma/enums';

export class AuthDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  phone?: string;

  @IsString()
  username: string;

  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  referralCode: string;

  @IsString()
  email: string;

  @IsString()
  roleName: string;

  @IsEnum(SubscriptionPlan)
  subscriptionPlan: SubscriptionPlan;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  ip_address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  profilePicture?: string;

  @IsOptional()
  @IsEnum(TestLevel)
  testLevel?: TestLevel;

  @IsOptional()
  @IsString()
  dob?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  bankCode?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  // @IsEnum(Language)
  @IsString()
  languagePreference?: string;

  @IsOptional()
  // @IsEnum(Subject)
  @IsString()
  subjectPreference?: string;

  @IsOptional()
  @IsString()
  bvn?: string;

  @IsOptional()
  @IsString()
  nin?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  roleName?: string;

  @IsOptional()
  @IsEnum(SubscriptionPlan)
  subscriptionPlan?: SubscriptionPlan;

  @IsOptional()
  @IsString()
  current_password?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  new_password?: string;

  @IsOptional()
  @IsString()
  customerCurrency: string;

  @IsOptional()
  @IsInt()
  defaultSplitPercentage: number;
}

export class UpdateOnboardingDto {
  @IsString()
  languagePreference: string;

  @IsString()
  subjectPreference: string;

  @IsEnum(['basic', 'intermediate', 'advanced'])
  testLevel: 'basic' | 'intermediate' | 'advanced';

  @IsIn(['5', '25', '50', '100', '200', '400', '1000'])
  questionPreference: string;

  @IsIn(['5', '15', '30', '45', '60', 'unlimited'])
  timePreference: string;
}

export class UserDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  phone?: string;

  @IsString()
  username: string;

  @IsString()
  email: string;

  @IsString()
  roleName: string;
}

export class KycDto {
  @IsDateString()
  dob: string;

  @IsString()
  country: string;

  @IsString()
  country_code: string;

  @IsString()
  number: string;

  @IsString()
  city?: string;

  @IsString()
  postal_code?: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  address: string;

  @IsString()
  bvn: string;

  @IsString()
  nin: string;

  @IsString()
  state: string;

  @IsString()
  verify_photo?: string;

    @IsOptional()
  @IsString()
  id_type: string;

  @IsOptional()
  @IsString()
  idNumber: string;

  @IsOptional()
  @IsString()
  idFrontBase64: string;

  @IsOptional()
  @IsString()
  idBackBase64: string;

  @IsOptional()
  @IsString()
  selfieBase64: string;
}

export class SubAdminDto {
  @IsOptional()
  @IsString()
  firstName: string;

  @IsOptional()
  @IsString()
  lastName: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  username: string;

  @IsOptional()
  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  email: string;

  @IsOptional()
  @IsString()
  roleName: string;

  @IsOptional()
  @IsString()
  inviteToken: string;
}

export class LoginDto {
  @IsString()
  identifier: string;

  @IsString()
  @IsOptional()
  ip_address?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  password: string;
}

export class SocialLoginDto {
  @IsOptional()
  @IsString()
  email: string;

  @IsOptional()
  @IsString()
  firstName: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  ip_address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  login_method: string;

  @IsOptional()
  @IsString()
  roleName: string;

  @IsOptional()
  @IsString()
  referralCode?: string; // optional, for referrals
}

export class VerifyEmailDto {
  @IsString()
  email: string;

  @IsString()
  @Length(6, 6)
  verificationCode: string;
}

export class ResendVerificationDto {
  @IsEmail()
  currentEmail: string;

  @IsOptional()
  @IsEmail()
  newEmail?: string;
}

export class ResetPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  resetToken: string;

  @IsString()
  @MinLength(6)
  newPassword: string;
}

export class SyncUserDto {
  @IsOptional()
  @IsString()
  referralCode?: string;

  @IsOptional()
  @IsString()
  ip_address?: string;

  @IsOptional()
  @IsString()
  location?: string;
}

export class RewardPaymentDto {
  @IsInt()
  amount: number;  
  
  
  @IsString()
  title: string;

  @IsString()
  description: string;
}
