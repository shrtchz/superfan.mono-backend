import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateQuizSessionDto {
  @IsString()
  @IsNotEmpty()
  quizId: string;

  @IsString()
  @IsNotEmpty()
  quizTitle: string;
}

export class SendQuizInvitationDto {
  @IsNumber()
  @IsNotEmpty()
  recipientId: number;

  @IsString()
  @IsNotEmpty()
  quizId: string;

  @IsString()
  @IsNotEmpty()
  quizTitle: string;

  @IsString()
  @IsOptional()
  sessionId?: string;
}

export class AcceptQuizInvitationDto {
  @IsString()
  @IsNotEmpty()
  invitationId: string;
}

export class DeclineQuizInvitationDto {
  @IsString()
  @IsNotEmpty()
  invitationId: string;
}

export class RecordSessionAnswerDto {
  @IsNumber()
  questionIndex: number;

  @IsString()
  @IsOptional()
  questionId?: string;

  @IsString()
  @IsNotEmpty()
  selectedOption: string;

  @IsBoolean()
  isCorrect: boolean;

  @IsNumber()
  pointsEarned: number;

  @IsNumber()
  timeTakenSeconds: number;
}

export class CompleteSessionParticipantDto {
  @IsNumber()
  @IsOptional()
  finalScore?: number;

  @IsNumber()
  @IsOptional()
  finalAccuracy?: number;

  @IsNumber()
  @IsOptional()
  totalTimeSeconds?: number;
}
