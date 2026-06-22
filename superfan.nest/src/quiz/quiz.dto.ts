import { TestLevel } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateQuizDto {
  @IsString()
  testQuiz: string;

  @IsEnum(TestLevel)
  testLevel: TestLevel;

  @IsString()
  subject: string;

  @IsString()
  question: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ImageLink: string[];

  @IsOptional()
  @IsBoolean()
  isTypedAnswer: boolean;

  @IsOptional()
  @IsBoolean()
  typedAnswer: boolean;

  @IsOptional()
  @IsBoolean()
  isRandom: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options: string[];

  @IsOptional()
  @IsString()
  answer: string;
}

export class RecordAnswerDto {
  @IsString()
  @IsNotEmpty()
  quizId: string;

  @IsString()
  @IsNotEmpty()
  selectedAnswer: string;
}

export class CreateLiveQuizDto {
  @IsString()
  question: string;

  @IsOptional()
  @IsString({ each: true })
  imageLink: string[];

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  options: string[];

  @IsString()
  answer: string;

  @IsNumber()
  recipients: number;

  @IsOptional()
  @IsBoolean()
  isTypedAnswer: boolean;

  @IsOptional()
  @IsBoolean()
  isRandom: boolean;

  @IsOptional()
  @IsBoolean()
  showAnswer: boolean;

  @IsOptional()
  @IsNumber()
  totalPrize: number;

  @IsOptional()
  @IsNumber()
  unitPrize: number;

  @IsOptional()
  @IsString()
  quizScheduleDate: string;
}

export class startRandomQuiz {
  @IsOptional()
  @IsString()
  quizId: string;

    
  // @IsOptional()
  // @IsNumber()
  // userId: number;

    @IsOptional()
  @Type(() => Number)
  @IsNumber()
  userId?: number;
}

export class GetQuizWithPreferencesDto {
  @IsString()
  @IsOptional()
  languagePreference: string;

  @IsString()
  @IsOptional()
  subjectPreference: string;

  @IsString()
  @IsOptional()
  testLevel: string;

  @IsString()
  @IsOptional()
  questionPreference: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  isRandom?: boolean;

  @IsString()
  @IsOptional()
  timePreference: string;
}

export class UpdateLiveAnswerDto {
  @IsString()
  userId: string;

  @IsString()
  quizId: string;

  @IsString()
  selectedAnswer: string;
}

export class SubmitLiveQuizDto {
  @IsString()
  userId: string;
}

export class CreateQuizCategoryDto {
  @IsString()
  testQuiz: string;

  @IsString()
  subject: string;
}
