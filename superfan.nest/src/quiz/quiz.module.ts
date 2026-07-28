import { HttpModule } from '@nestjs/axios';
import { Module, forwardRef } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { WalletModule } from '../wallet/wallet.module';
import { PaymentModule } from '../payment/payment.module';
import { TaskModule } from '../tasks/tasks.module';
import { QuizController } from './quiz.controller';
import { QuizService } from './quiz.service';
import { QuestionAddedListener } from './listeners/question-added.listener';

@Module({
  imports: [HttpModule, forwardRef(() => UserModule), WalletModule, PaymentModule, forwardRef(() => TaskModule)],
  controllers: [QuizController],
  providers: [QuizService, QuestionAddedListener],
  exports: [QuizService],
})
export class QuizModule {}
