import { IsNotEmpty, IsNumber, IsPositive, IsString, IsIn } from 'class-validator';

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
  @IsIn(['gold', 'personal', 'savings', 'checking', 'Savings', 'Checking'])
  fundingAccount: string;
}

export class AcceptVersusDto {
  @IsString()
  @IsIn(['gold', 'personal', 'savings', 'checking', 'Savings', 'Checking'])
  fundingAccount: string;
}
