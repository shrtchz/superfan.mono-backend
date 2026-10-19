import { MailerService } from '@nestjs-modules/mailer';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as fs from 'fs';
import * as handlebars from 'handlebars';
import { resolveTemplatePath, resolveTemplatesDir } from './mail.utils';

@Processor('mail', {
  stalledInterval: 300000, // 5 minutes (reduces Redis polling to save Upstash quota without crashing)
})
@Injectable()
export class Mailprocessor extends WorkerHost {
  private readonly logger = new Logger(Mailprocessor.name);
  private zeptoClient: any = null;

  constructor(private readonly mailerService: MailerService) {
    super();
  }

  private async getZeptoClient() {
    if (!this.zeptoClient) {
      const { SendMailClient } = await import('zeptomail');
      this.zeptoClient = new SendMailClient({
        url: 'https://api.zeptomail.com/v1.1/email',
        token: process.env.ZEPTOMAIL_TOKEN,
      });
    }
    return this.zeptoClient;
  }

  private async renderTemplate(
    templateName: string,
    context: any,
  ): Promise<string> {
    const templatePath = resolveTemplatePath(templateName, __dirname);
    if (!fs.existsSync(templatePath)) {
      throw new Error(
        `Email template not found: "${templateName}" at ${templatePath}`,
      );
    }
    const templateContent = fs.readFileSync(templatePath, 'utf-8');
    const compiled = handlebars.compile(templateContent);
    return compiled(context || {});
  }

  async process(job: Job<any>) {
    this.logger.log(`Processing mail job ${job.id} (${job.name}) for ${job.data?.to}`);

    try {
      switch (job.name) {
        case 'send_email':
          const result = await this.sendEmail(job);
          this.logger.log(`Job ${job.id} completed successfully: ${JSON.stringify(result)}`);
          return result;
        default:
          throw new Error(`Unknown job name: ${job.name}`);
      }
    } catch (error) {
      this.logger.error(
        `Job ${job.id} failed after ${job.attemptsMade} attempts. Job data:`,
        {
          jobId: job.id,
          jobName: job.name,
          attempts: job.attemptsMade,
          to: job.data?.to,
          errorMessage: error?.message,
          errorStack: error?.stack,
        },
      );
      throw error;
    }
  }

  private async sendEmail(job: Job) {
    const { to, from, subject, template, context } = job.data;
    const htmlBody = await this.renderTemplate(template, context);

    const senderEmail =
      process.env.PROD_SENDER_EMAIL ||
      process.env.LOCAL_SENDER_EMAIL ||
      'admin@superfan.ng';
    const senderName =
      process.env.PROD_SENDER_NAME ||
      process.env.LOCAL_SENDER_NAME ||
      'Superfan';

    // 1. Primary: ZeptoMail
    try {
      const zeptoClient = await this.getZeptoClient();
      await zeptoClient.sendMail({
        from: {
          address: senderEmail,
          name: senderName,
        },
        to: [
          {
            email_address: {
              address: to,
            },
          },
        ],
        subject,
        htmlbody: htmlBody,
      });

      this.logger.log(`Email sent via ZeptoMail to ${to}`);
      return { success: true, method: 'zepto' };
    } catch (zeptoError) {
      this.logger.warn(
        `ZeptoMail sending failed for ${to}. Falling back to MailerService (SMTP). Error: ${zeptoError?.message}`,
        zeptoError?.stack,
      );

      // 2. Fallback: MailerService (SMTP) passing pre-rendered HTML
      try {
        await this.mailerService.sendMail({
          to,
          from: from || `"${senderName}" <${senderEmail}>`,
          subject,
          html: htmlBody,
        });

        this.logger.log(`Email sent via SMTP fallback to ${to}`);
        return { success: true, method: 'smtp' };
      } catch (smtpError) {
        this.logger.error(
          `Both mail providers failed for recipient ${to}. ZeptoMail error: ${zeptoError?.message}, SMTP error: ${smtpError?.message}`,
          {
            zeptoError: zeptoError?.stack,
            smtpError: smtpError?.stack,
            recipient: to,
            subject,
            template,
          },
        );
        throw new Error(
          `Failed to send email to ${to}: ZeptoMail - ${zeptoError?.message}. SMTP - ${smtpError?.message}`,
        );
      }
    }
  }
}

