import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export class ConfigurePaymentProcessorDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  publicKey?: string;

  @IsOptional()
  @IsString()
  secretKey?: string;

  @IsOptional()
  @IsObject()
  additionalFields?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isConnected?: boolean;
}
