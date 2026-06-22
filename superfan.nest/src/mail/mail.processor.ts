import { MailerService } from '@nestjs-modules/mailer';
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import * as fs from 'fs';
import * as path from 'path';

@Processor('mail')
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

    private async renderTemplate(templateName: string, context: any): Promise<string> {
        const templatePath = this.resolveTemplatePath(templateName);
        const templateContent = fs.readFileSync(templatePath, 'utf-8');
        
        // Simple template rendering (replace {{variable}} with values)
        let html = templateContent;
        Object.keys(context || {}).forEach(key => {
            const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
            html = html.replace(regex, context[key]);
        });
        
        return html;
    }

    private resolveTemplatesDir(): string {
      const localDir = path.join(__dirname, 'templates');
      const distAlternative = path.join(__dirname, '..', '..', 'mail', 'templates');

      if (fs.existsSync(localDir)) {
        return localDir;
      }

      if (fs.existsSync(distAlternative)) {
        return distAlternative;
      }

      return localDir;
    }

    private resolveTemplatePath(templateName: string): string {
      return path.join(this.resolveTemplatesDir(), `${templateName}.hbs`);
    }

    async process(job: Job<any>) {
        this.logger.log(`Sending email.... Job ${job.id}`);

        try {
            switch (job.name) {
                case 'send_email':
                    let send_mail = await this.sendEmail(job);
                    console.log(send_mail, 'send_mail')

                    return send_mail;
                default:
                    throw new Error(`Unknown job name: ${job.name}`)
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
                }
            );
            throw error;
        }
    }

    private async sendEmail(job: Job) {
        const { to, from, subject, template, context } = job.data;
        const htmlBody = await this.renderTemplate(template, context);

                    try {
                // Fallback to ZeptoMail
                const zeptoClient = await this.getZeptoClient();
                await zeptoClient.sendMail({
                    from: {
                        address: 'admin@superfan.ng',
                        name: 'Superfan',
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

                        } catch (error) {
            this.logger.error(
                `Primary mail provider failed for ${to}, trying ZeptoMail. Error: ${error?.message}`,
                error?.stack,
            );
        
        try {
            // Primary provider
            await this.mailerService.sendMail({
                to,
                from,
                subject,
                template,
                context,
            });

            this.logger.log(`Email sent via primary provider to ${to}`);
            return { success: true, method: 'primary' };



            } catch (zeptoError) {
                this.logger.error(
                    `Both mail providers failed for recipient ${to}. Primary error: ${error?.message}, ZeptoMail error: ${zeptoError?.message}`,
                    {
                        primaryError: error?.stack,
                        zeptoError: zeptoError?.stack,
                        recipient: to,
                        subject,
                        template,
                    }
                );
                throw new Error(`Failed to send email to ${to}: Primary - ${error?.message}. ZeptoMail - ${zeptoError?.message}`);
            }
        }
    }

}
