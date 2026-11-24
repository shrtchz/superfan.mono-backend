import { IsNotEmpty, IsNumber, IsPositive, IsString, IsIn, IsOptional, IsBoolean, Min } from 'class-validator';

export class ConfigureJackpotDto {
  @IsNumber()
  @IsPositive()
  participantsTarget: number;

  @IsNumber()
  @IsPositive()
  amountToDisburse: number;

  @IsNumber()
  @IsPositive()
  unitPayPerMatch: number;

  @IsString()
  @IsNotEmpty()
  alertSendDate: string;

  @IsOptional()
  @IsNumber()
  actualPayout?: number;

  @IsOptional()
  @IsNumber()
  remainder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateVersusDto {
  @IsString()
  @IsNotEmpty()
  opponent: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['Live 1v1', 'Schedule H2H', 'LIVE_1V1', 'SCHEDULE_H2H'])
  mode: string;

  @IsNumber()
  @IsPositive()
  jackpot: number;

  @IsNumber()
  @Min(0)
  hostShare: number;

  @IsNumber()
  @Min(0)
  opponentShare: number;

  @IsOptional()
  @IsString()
  @IsIn(['savings', 'checking', 'Savings', 'Checking'])
  fundingAccount?: string;

  @IsOptional()
  @IsBoolean()
  isJackpot?: boolean;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  level?: string;

  @IsOptional()
  @IsNumber()
  questionsCount?: number;

  @IsOptional()
  @IsNumber()
  durationMinutes?: number;
}

export class AcceptVersusDto {
  @IsOptional()
  @IsString()
  @IsIn(['savings', 'checking', 'Savings', 'Checking'])
  fundingAccount?: string;
}

export class FundVersusDto {
  @IsString()
  @IsIn(['savings', 'checking', 'Savings', 'Checking'])
  fundingAccount: string;
}

export class ToggleReadyDto {
  @IsBoolean()
  ready: boolean;
}

export class SubmitVersusResultDto {
  @IsNumber()
  score: number;

  @IsNumber()
  timeSeconds: number;

  @IsNumber()
  accuracy: number;

  @IsNumber()
  streak: number;

  @IsOptional()
  answers?: any[];

  @IsOptional()
  questions?: any[];
}
