import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { UserModule } from '../user/user.module';
import { QuizModule } from '../quiz/quiz.module';
import { VersusModule } from '../versus/versus.module';
import { CronJobService } from './cronjob.service';

@Module({
  imports: [HttpModule, NotificationModule, UserModule, QuizModule, VersusModule],
  providers: [CronJobService],
  exports: [CronJobService],
})
export class CronJobModule {}