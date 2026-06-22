import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import * as fs from 'fs';
import * as handlebars from 'handlebars';
import path from 'path';
import { failureResponse } from '../common/interceptors/response.interceptor';

@Injectable()
export class MailService implements OnModuleInit {
  constructor(
    @InjectQueue('mail') private readonly mailQueue: Queue,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.registerPartials();
  }

  private registerPartials() {
    const partialsDir = this.resolveTemplatesDir();

    if (fs.existsSync(partialsDir)) {
      const files = this.findHbsFiles(partialsDir);

      files.forEach((file) => {
        const templateExt = path.extname(file) || '.hbs';
        let templateName = path.basename(file, templateExt);
        const templateBaseDir = partialsDir;
        templateName = path
          .relative(templateBaseDir, file)
          .replace(templateExt, '');

        try {
          const template = fs.readFileSync(file, 'utf-8');
          handlebars.registerPartial(templateName, template);
        } catch (err) {
          console.error(`Failed to register partial ${templateName}:`, err);
        }
      });
    } else {
      console.warn(`Partials directory not found at ${partialsDir}`);
    }
  }

  private findHbsFiles(dir: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    list.forEach((file) => {
      file = path.join(dir, file);
      const stat = fs.statSync(file);
      if (stat && stat.isDirectory()) {
        results = results.concat(this.findHbsFiles(file));
      } else {
        if (path.extname(file) === '.hbs') {
          results.push(file);
        }
      }
    });
    return results;
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

  async sendTestEmail(to: string, subject: string, context: any) {
    try {
      await this.mailQueue.add('send_email', {
        to,
        from: `Superfan <${
          this.configService.get<string>('LOCAL_SENDER_EMAIL') ||
          this.configService.get<string>('PROD_SENDER_EMAIL')
        }>`,
        subject,
        template: './test-email',
        context,
      });
    }
    catch (error) {
      throw failureResponse(error);
    }
  }

  async verifyEmail(email: string, code: string, firstName: string): Promise<any> {
    try {
      const verify_url = `${process.env.FRONTEND_URL}/verify/${email}?token=${code}`
      let send_text = await this.mailQueue.add('send_email', {
        to: email,
        from: `Superfan <${
          this.configService.get<string>('LOCAL_SENDER_EMAIL') ||
          this.configService.get<string>('PROD_SENDER_EMAIL')
        }>`,
        subject: 'Verify your email',
        template: './verify-email',
        context: { email, verify_url, firstName },
      },
        {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 10000,
    },
  },
    );
    } catch (error) {
      throw failureResponse(error);
    }
  }

  async welcomeUserEmail(email: string, firstName: string, magicLink: string) {
  try {
    await this.mailQueue.add('send_email', {
      to: email,
      from: `Superfan <${
        this.configService.get<string>('LOCAL_SENDER_EMAIL') ||
        this.configService.get<string>('PROD_SENDER_EMAIL')
      }>`,
      subject: 'Welcome to superfan!',
      template: './welcome-superfan',
      context: { email, firstName, start_quiz_url: magicLink },
    });
  } catch (error) {
    throw failureResponse(error);
  }
}

  // in email, figure out which details should be used for the link.
  // check the link in the frontend and make sure it works with the details sent in the email.
  // in frontend, only email needs to be sent to the backend, so i am guessing, email will contain link that accepts the complete user details. i.e. firstName, lastName, email(prefilled), phone, password..
  async subAdminInvitationEmail(
    email: string,
    inviterName: string,
    inviteUrl: string,
    role,
    expiryDays,
    expiryDate,
  ): Promise<any> {
    try {
      let send_text = await this.mailQueue.add('send_email', {
        to: email,
        from: `Superfan <${
          this.configService.get<string>('LOCAL_SENDER_EMAIL') ||
          this.configService.get<string>('PROD_SENDER_EMAIL')
        }>`,
        subject: `You have been invited to be a ${role}`,
        template: './subadmin-invitation',
        context: {
          email,
          inviterName,
          inviteUrl,
          role,
          expiryDays,
          expiryDate,
        },
      });
    } catch (error) {
      throw failureResponse(error);
    }
  }

  async welcomeSubadminEmail(email: string): Promise<any> {
    try {
      await this.mailQueue.add('send_email', {
        to: email,
        from: `Superfan <${
          this.configService.get<string>('LOCAL_SENDER_EMAIL') ||
          this.configService.get<string>('PROD_SENDER_EMAIL')
        }>`,
        subject: 'Welcome to the team!',
        template: 'welcome-subadmin',
        context: { email },
      });
    } catch (error) {
      throw failureResponse(error);
    }
  }

  async sendPasswordReset(email: string, code: string): Promise<any> {
    try {
      await this.mailQueue.add('send_email', {
        to: email,
        from: `Superfan <${
          this.configService.get<string>('LOCAL_SENDER_EMAIL') ||
          this.configService.get<string>('PROD_SENDER_EMAIL')
        }>`,
        subject: 'Password reset request',
        template: 'password-reset',
        context: { email, code },
      });
    } catch (error) {
      throw failureResponse(error);
    }
  }

  async sendForgotPassword(email: string, resetToken: string[], username: string) {
    // const resetUrl = `${process.env.FRONTEND_URL}update-password?token=${resetToken}`;

    try {
      await this.mailQueue.add('send_email', {
        to: email,
        from: `Superfan <${
          this.configService.get<string>('LOCAL_SENDER_EMAIL') ||
          this.configService.get<string>('PROD_SENDER_EMAIL')
        }>`,
        subject: 'Reset your Superfan password',
        template: './password-reset.hbs',
        context: {
          resetToken,
          email,
          username
        },
      });
    } catch (error) {
      throw failureResponse(error);
    }
  }
}
