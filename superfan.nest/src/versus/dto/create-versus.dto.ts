import { IsNotEmpty, IsNumber, IsPositive, IsString, IsIn, IsOptional, IsBoolean } from 'class-validator';

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
  @IsPositive()
  hostShare: number;

  @IsNumber()
  @IsPositive()
  opponentShare: number;

  @IsString()
  @IsIn(['savings', 'checking', 'Savings', 'Checking'])
  fundingAccount: string;

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
