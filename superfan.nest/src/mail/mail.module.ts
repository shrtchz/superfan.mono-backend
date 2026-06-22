import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { join } from 'path';
import { Mailprocessor } from './mail.processor';
import { MailService } from './mail.service';
import { RedisService } from './redis.service';

function resolveTemplatesDir(): string {
  const localDir = join(__dirname, 'templates');
  const distAlternative = join(__dirname, '..', '..', 'mail', 'templates');

  if (fs.existsSync(localDir)) {
    return localDir;
  }

  if (fs.existsSync(distAlternative)) {
    return distAlternative;
  }

  return localDir;
}

@Global()
@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({
      name: 'mail',
    }),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        let mailTransport;
        let senderEmail;
        if (process.env.NODE_ENV === 'development') {
          senderEmail = configService.get<string>('LOCAL_SENDER_EMAIL');

          mailTransport = {
            host: configService.get<string>('LOCAL_MAIL_HOST'),
            port: Number(configService.get('LOCAL_EMAIL_PORT')),
            secure: configService.get<boolean>('LOCAL_EMAIL_SECURE'),
            auth: {
              user: senderEmail,
              pass: configService.get<string>('LOCAL_MAIL_SENDER_PASSWORD'),
            },
          };
        } else {
          senderEmail = configService.get<string>('PROD_SENDER_EMAIL');

          mailTransport = {
            host: configService.get<string>('PROD_MAIL_HOST'),
            port: Number(configService.get('PROD_MAIL_PORT')),
            secure: false,
            auth: {
              user: 'emailapikey',
              // senderEmail,
              pass: configService.get<string>('PROD_MAIL_SENDER_PASSWORD'),
            },
          };
        }
        return {
          transport: mailTransport,
          defaults: {
            from: `"${
              process.env.NODE_ENV === 'development'
                ? process.env.LOCAL_SENDER_NAME
                : process.env.PROD_SENDER_NAME
            }"`,
          },
          template: {
            dir: resolveTemplatesDir(),
            adapter: new HandlebarsAdapter(),
            options: {
              strict: true,
            },
          },
        };
      },
    }),
  ],
  providers: [MailService, RedisService, Mailprocessor],
  exports: [MailService, RedisService],
})
export class MailModule {}
