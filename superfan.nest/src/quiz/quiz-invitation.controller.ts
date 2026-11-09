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
import { QuizInvitationService } from './quiz-invitation.service';
import {
  SendQuizInvitationDto,
} from './dto/quiz-session.dto';

@UseGuards(JwtGuard)
@Controller('api/v1/quiz/invitations')
export class QuizInvitationController {
  constructor(private readonly quizInvitationService: QuizInvitationService) {}

  @Post('send')
  async sendInvitation(@Req() req: any, @Body() dto: SendQuizInvitationDto) {
    return this.quizInvitationService.sendInvitation(req.user.id, dto);
  }

  @Get('pending')
  async getPendingInvitations(@Req() req: any) {
    return this.quizInvitationService.getPendingInvitations(req.user.id);
  }

  @Get('sent')
  async getSentInvitations(@Req() req: any) {
    return this.quizInvitationService.getSentInvitations(req.user.id);
  }

  @Post(':id/accept')
  async acceptInvitation(@Req() req: any, @Param('id') id: string) {
    return this.quizInvitationService.acceptInvitation(req.user.id, id);
  }

  @Post(':id/decline')
  async declineInvitation(@Req() req: any, @Param('id') id: string) {
    return this.quizInvitationService.declineInvitation(req.user.id, id);
  }
}
