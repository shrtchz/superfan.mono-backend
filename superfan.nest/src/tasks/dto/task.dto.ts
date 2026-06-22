import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { TaskPriority, TaskStatus } from '../../common/enums/task.enum';
import { PayoutMethod } from '@prisma/client';
// import { PayoutMethod } from '../../generated/prisma/enums';

export class TaskDto {
  @IsString()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;

  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsDateString()
  @IsOptional()
  assignmentDate?: string;

  @IsInt()
  userId: number; // ✅ receiver

  @IsInt()
  assignerId: number; // ✅ superadmin assigning
}

export class TaskMessageDto {
  @IsInt()
  @IsOptional()
  taskId?: number;

  @IsInt()
  @IsOptional()
  senderId?: number;

  @IsString()
  @IsOptional()
  message?: string;
}

export class GetTasksQueryDto {
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;
}

export class GetClientHistoryDto {
  @Type(() => Number)
  @IsInt()
  userId: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;
}

export class CreateClientHistoryDto {
  @IsInt()
  userId: number;

  @IsInt()
  creatorId: number;

  @IsEnum(['REPORT', 'FEEDBACK']) // adjust to your enum
  type: 'REPORT' | 'FEEDBACK';

  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsEnum(['ADMIN', 'SYSTEM']) // adjust to your enum
  submittedBy: 'ADMIN' | 'SYSTEM';
}

export class CreatePayoutDto {
  @IsInt()
  userId: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'amount must be a valid number' })
  amount: number;

  @IsEnum(PayoutMethod)
  method: PayoutMethod; // e.g., 'bank_transfer', 'mobile_money', etc.

  @IsString()
  reference: string; // e.g., bank account number, mobile money number, etc.

  @IsString()
  currency: string; // e.g., 'USD', 'NGN', etc.

  @IsString()
  status: string; // e.g., 'PENDING', 'COMPLETED', etc.

  @IsString()
  provider: string; // e.g., 'Monnify', 'Busha', etc.
}
