import { EarningStatus } from "@prisma/client";
import { IsEnum, IsNumber, IsString } from "class-validator";

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