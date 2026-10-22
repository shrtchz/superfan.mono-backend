import { Module } from '@nestjs/common';
import { DatabaseModule } from '../config/database/database.module';
import { NotificationModule } from '../notification/notification.module';
import { QuizModule } from '../quiz/quiz.module';
import { VersusController } from './versus.controller';
import { VersusService } from './versus.service';

@Module({
  imports: [DatabaseModule, NotificationModule, QuizModule],
  controllers: [VersusController],
  providers: [VersusService],
  exports: [VersusService],
})
export class VersusModule {}
