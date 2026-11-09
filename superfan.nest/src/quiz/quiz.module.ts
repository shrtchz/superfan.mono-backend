import { HttpModule } from '@nestjs/axios';
import { Module, forwardRef } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { WalletModule } from '../wallet/wallet.module';
import { TaskModule } from '../tasks/tasks.module';
import { NotificationModule } from '../notification/notification.module';
import { QuizController } from './quiz.controller';
import { QuizService } from './quiz.service';
import { QuizSessionController } from './quiz-session.controller';
import { QuizSessionService } from './quiz-session.service';
import { QuizInvitationController } from './quiz-invitation.controller';
import { QuizInvitationService } from './quiz-invitation.service';
import { QuestionAddedListener } from './listeners/question-added.listener';
import { ExchangeRateService } from '../common/services/exchange-rate.service';

@Module({
  imports: [
    HttpModule,
    forwardRef(() => UserModule),
    WalletModule,
    forwardRef(() => TaskModule),
    NotificationModule,
  ],
  controllers: [
    QuizController,
    QuizSessionController,
    QuizInvitationController,
  ],
  providers: [
    QuizService,
    QuizSessionService,
    QuizInvitationService,
    QuestionAddedListener,
    ExchangeRateService,
  ],
  exports: [QuizService, QuizSessionService, QuizInvitationService],
})
export class QuizModule {}
