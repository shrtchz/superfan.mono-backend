import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../common/guards';
import { QuizSessionService } from './quiz-session.service';
import {
  CompleteSessionParticipantDto,
  CreateQuizSessionDto,
  RecordSessionAnswerDto,
} from './dto/quiz-session.dto';

@UseGuards(JwtGuard)
@Controller('api/v1/quiz/sessions')
export class QuizSessionController {
  constructor(private readonly quizSessionService: QuizSessionService) {}

  @Post()
  async createSession(@Req() req: any, @Body() dto: CreateQuizSessionDto) {
    return this.quizSessionService.createSession(req.user.id, dto);
  }

  @Get(':sessionId')
  async getSession(@Req() req: any, @Param('sessionId') sessionId: string) {
    return this.quizSessionService.getSession(sessionId, req.user?.id);
  }

  @Post(':sessionId/answers')
  async recordAnswer(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @Body() dto: RecordSessionAnswerDto,
  ) {
    return this.quizSessionService.recordAnswer(sessionId, req.user.id, dto);
  }

  @Post(':sessionId/complete')
  async completeParticipant(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @Body() dto: CompleteSessionParticipantDto,
  ) {
    return this.quizSessionService.completeParticipant(sessionId, req.user.id, dto);
  }

  @Get(':sessionId/scoreboard')
  async getScoreboard(@Param('sessionId') sessionId: string) {
    return this.quizSessionService.getScoreboard(sessionId);
  }
}
