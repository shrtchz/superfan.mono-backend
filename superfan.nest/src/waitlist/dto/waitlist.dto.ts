import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class JoinWaitlistDto {
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  hearAbout?: string;
}
