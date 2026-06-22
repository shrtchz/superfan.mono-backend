import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StreamingService } from './stream.service';
import { StreamingController } from './stream.controller';
import { StreamGateway } from './stream.gateway';
import { MailModule } from '../mail/mail.module';
import { QuizModule } from '../quiz/quiz.module';
import { HttpModule } from '@nestjs/axios';


@Module({
  imports: [ConfigModule, MailModule, QuizModule, HttpModule], // make sure ConfigModule is global or imported here
  controllers: [StreamingController],
  providers: [StreamingService, StreamGateway],
  exports: [StreamingService], // export if other modules need it
})
export class StreamingModule {}
