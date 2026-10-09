import { EarningStatus } from "@prisma/client";
import { IsEnum, IsNumber, IsOptional, IsString } from "class-validator";
import { Type } from "class-transformer";

export class QuizRewardDto {
    @IsNumber()
    userId: number;

    @IsNumber()
    amount: number;

    @IsString()
    currency: string;

    @IsString()
    type: string;

    @IsEnum(EarningStatus)
    status: EarningStatus;

    @IsNumber()
    points: number;
}

export class WalletTransactionFilterDto {
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    userId?: number;

    @IsOptional()
    @IsString()
    startDate?: string;

    @IsOptional()
    @IsString()
    endDate?: string;

    @IsOptional()
    @IsString()
    type?: string; // 'credit' | 'debit'

    @IsOptional()
    @IsString()
    accountType?: string; // 'Gold' | 'Personal'

    @IsOptional()
    @IsString()
    currency?: string; // 'NGN' | 'USDC' | 'USDT'

    @IsOptional()
    @IsString()
    status?: string; // 'PENDING' | 'SUCCESS' | 'FAILED'

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    limit?: number;
}