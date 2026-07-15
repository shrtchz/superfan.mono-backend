import { BullModule } from '@nestjs/bullmq';
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import * as path from 'path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  APP_FILTER,
  APP_GUARD,
  Reflector
} from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { FlutterwaveModule } from '@scwar/nestjs-flutterwave';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { AdminModule } from './admin/admin.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { JwtGuard } from './common/guards/jwt.guard';
import { RoleGuard } from './common/guards/roles.guard';
import { AccessControlService } from './common/shared/access-control.service';
import { DatabaseModule } from './config/database/database.module';
import { CronJobModule } from './cronjobs/cronjob.module';
import { HealthModule } from './health/health.module';
import { ImageModule } from './image/image.module';
import { NotificationModule } from './notification/notification.module';
import { PaymentModule } from './payment/payment.module';
import { PermissionModule } from './permission/permission.module';
import { QuizModule } from './quiz/quiz.module';
import { QuotesModule } from './quote/quote.module';
import { ResetModule } from './reset/reset.module';
import { TaskModule } from './tasks/tasks.module';
import { UserModule } from './user/user.module';
import { WalletModule } from './wallet/wallet.module';
import { WebhookModule } from './webhook/webhook.module';
import { StreamingModule } from './stream/stream.module';
import { ElasticsearchModule } from './elasticsearch/elasticsearch.module';
import { LoggingMiddleware } from './common/middleware/logging.middleware';
import { WaitlistModule } from './waitlist/waitlist.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        '/etc/secrets/.env',
        path.resolve(__dirname, '../../../.env'),
        path.resolve(__dirname, '../../.env'),
        '.env',
      ],
    }),
    SentryModule.forRoot(),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: process.env.JWT_SECRET,
        signOptions: { expiresIn: '6h' },
      }),
      inject: [ConfigService],
    }),
        FlutterwaveModule.forRoot({
      publicKey: process.env.FLW_PUBLIC_KEY,
      secretKey: process.env.FLW_SECRET_KEY,
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    ElasticsearchModule,
    DatabaseModule,
    HealthModule,
    PermissionModule,
    AdminModule,
    TaskModule,
    AnalyticsModule,
    WalletModule,
    CronJobModule,
    QuotesModule,
    ImageModule,
    UserModule,
    NotificationModule,
    QuizModule,
    PaymentModule,
    StreamingModule,
    WebhookModule,
    ResetModule,
    WaitlistModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        ...(configService.get('REDIS_URL')
          ? {
              connection: {
                url: configService.get('REDIS_URL'),
                // tls: {},
                // maxRetriesPerRequest: null,
              },
            }
          : {
              connection: {
                host: configService.get('LOCAL_REDIS_HOST') || '127.0.0.1',
                port: configService.get('LOCAL_REDIS_PORT', 6379),
                maxRetriesPerRequest: null,
              },
            }),
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: true,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AppController],
  providers: [
    Reflector,
    {
      provide: APP_GUARD,
      useClass: JwtGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RoleGuard,
    },

    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    AccessControlService,
    AppService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
